/* ── message-builder.js — API 消息构建（纯函数，零 DOM 依赖）──── */

const MessageBuilder = {

  buildApiMessages: function (session, agentId, displayText, attachmentPaths) {
    const chatMessages = (session && session.messages) || [];
    const targetAgentId = agentId || 'main';
    const ap = attachmentPaths || [];

    const mainDisplayName = (function () {
      const mainAgent = State.findAgent('main');
      return mainAgent ? (mainAgent.displayName || mainAgent.name) : '主助理';
    })();

    let apiMessages = chatMessages.map(function (m) {
      if (m.role === 'assistant' && m.agentId && m.agentId !== targetAgentId) {
        const srcAgent = State.findAgent(m.agentId);
        const srcName = srcAgent ? (srcAgent.displayName || srcAgent.name) : m.agentId;
        return { role: 'assistant', content: '[' + srcName + ' said]: ' + (m.content || '') };
      }

      // 兜底：无 agentId 的 assistant 消息（旧 session 数据），direct 模式下标为 [主助理 said]
      // 注意：这是向后兼容的临时措施，等 chat-controller.js 的 agentId 保存覆盖所有旧数据后可移除
      if (m.role === 'assistant' && !m.agentId && targetAgentId !== 'main') {
        return { role: 'assistant', content: '[' + mainDisplayName + ' said]: ' + (m.content || '') };
      }

      // direct 模式下，重写 user 消息内嵌的 [Chat messages] 块，给 Assistant 行加说话人标注
      if (m.role === 'user' && targetAgentId !== 'main') {
        var rewrittenContent = MessageBuilder._rewriteEmbeddedChatContext(m.content || '', mainDisplayName);
        if (m.attachments && m.attachments.length > 0) {
          return MessageBuilder.buildMultimodalMessage(rewrittenContent, m.attachments);
        }
        return { role: 'user', content: rewrittenContent };
      }

      if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
        return MessageBuilder.buildMultimodalMessage(m.content, m.attachments);
      }

      return { role: m.role, content: m.content || '' };
    });

    if (apiMessages.length === 0) {
      if (ap.length > 0) {
        apiMessages = [{ role: 'user', content: MessageBuilder.buildMultimodalContent(displayText, ap) }];
      } else {
        apiMessages = [{ role: 'user', content: displayText }];
      }
    } else if (ap.length > 0) {
      const lastMsg = apiMessages[apiMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content = MessageBuilder.buildMultimodalContent(displayText, ap);
      }
    }

    return apiMessages;
  },

  buildAttachmentDisplayText: function (text, attachmentPaths) {
    if (!attachmentPaths || attachmentPaths.length === 0) return text;
    const attInfo = attachmentPaths.map(function (a) {
      const icon = a.type && a.type.indexOf('image/') === 0 ? '🖼' : '📄';
      return '\n' + icon + ' ' + (a.name || '附件');
    }).join('');
    return (text || '') + attInfo;
  },

  /**
   * 重写 user 消息内嵌的 [Chat messages] 块，给 Assistant 行加说话人标注
   * 只在 direct 模式（targetAgentId !== 'main') 调用，dispatch 模式不调用
   * @param {string} text - 原始消息文本
   * @param {string} displayName - 主助理的显示名称
   * @returns {string} 重写后的文本
   */
  _rewriteEmbeddedChatContext: function (text, displayName) {
    if (!text) return text;
    var marker = '[Chat messages since your last reply - for context]';
    var markerIdx = text.indexOf(marker);
    if (markerIdx < 0) return text;

    // 只重写 marker 之后的部分，marker 之前的内容原样保留
    var beforeMarker = text.substring(0, markerIdx + marker.length);
    var afterMarker = text.substring(markerIdx + marker.length);

    // 替换块内紧跟换行符的 "Assistant:" 行
    var rewritten = afterMarker.replace(/\nAssistant:/g, '\nAssistant [' + displayName + ']:');

    return beforeMarker + rewritten;
  },

  buildMultimodalMessage: function (textContent, attachments) {
    return { role: 'user', content: MessageBuilder.buildMultimodalContent(textContent, attachments) };
  },

  buildMultimodalContent: function (textContent, attachments) {
    const parts = [];

    const cleanText = (textContent || '').split('\n').filter(function (line) {
      return !Constants.REGEX.ATTACHMENT_LINE_TEST.test(line);
    }).join('\n').trim();
    if (cleanText) {
      parts.push({ type: 'text', text: cleanText });
    }

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const isImage = att.type && att.type.indexOf('image/') === 0;
      if (isImage && att.dataUrl) {
        parts.push({
          type: 'image_url',
          image_url: { url: att.dataUrl },
        });
      } else if (isImage && att.path) {
        parts.push({
          type: 'image_url',
          image_url: { url: window.location.origin + att.path },
        });
      } else if (att.path) {
        if (att.content) {
          const langMatch = att.name ? att.name.match(/\.(\w+)$/) : null;
          const lang = langMatch ? langMatch[1] : '';
          parts.push({
            type: 'text',
            text: '[文件: ' + att.name + ']\n```' + lang + '\n' + att.content + '\n```',
          });
        } else {
          parts.push({
            type: 'text',
            text: '[文件: ' + att.name + ']',
          });
        }
      }
    }

    if (parts.length === 1 && parts[0].type === 'text' && !parts[0].text.startsWith('[附件')) {
      return parts[0].text;
    }
    return parts;
  },
};
