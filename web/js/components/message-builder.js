/* ── message-builder.js — API 消息构建（纯函数，零 DOM 依赖）──── */

const _ATT_LINE_RE = /^[\u{1F5BC}\u{1F4C4}\u{1F4E6}\u{1F4DD}\u{1F4CA}\u{1F4C3}\u{1F4CE}]\s/u;
const MessageBuilder = {

  buildApiMessages: function (session, agentId, displayText, attachmentPaths) {
    const chatMessages = (session && session.messages) || [];
    const targetAgentId = agentId || 'main';
    const ap = attachmentPaths || [];

    let apiMessages = chatMessages.map(function (m) {
      if (m.role === 'assistant' && m.agentId && m.agentId !== targetAgentId) {
        const srcAgent = State.findAgent(m.agentId);
        const srcName = srcAgent ? (srcAgent.displayName || srcAgent.name) : m.agentId;
        var announceText = m.content || '';
        if (m.announces && m.announces.length > 0) {
          for (let k = 0; k < m.announces.length; k++) {
            announceText += '\n\n---\n\n';
            if (m.announces[k].agentId) announceText += '[' + m.announces[k].agentId + '] ';
            announceText += m.announces[k].content;
          }
        }
        return { role: 'assistant', content: '[' + srcName + ' said]: ' + announceText };
      }

      if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
        return MessageBuilder.buildMultimodalMessage(m.content, m.attachments);
      }

      var msgContent = m.content || '';
      if (m.announces && m.announces.length > 0) {
        for (let k = 0; k < m.announces.length; k++) {
          msgContent += '\n\n---\n\n';
          if (m.announces[k].agentId) msgContent += '[' + m.announces[k].agentId + '] ';
          msgContent += m.announces[k].content;
        }
      }
      return { role: m.role, content: msgContent };
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

  buildMultimodalMessage: function (textContent, attachments) {
    return { role: 'user', content: MessageBuilder.buildMultimodalContent(textContent, attachments) };
  },

  buildMultimodalContent: function (textContent, attachments) {
    const parts = [];

    const cleanText = (textContent || '').split('\n').filter(function (line) {
      return !_ATT_LINE_RE.test(line);
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
        parts.push({
          type: 'text',
          text: '[附件: ' + att.name + ' (路径: ' + att.path + ', 类型: ' + att.type + ')]',
        });
      }
    }

    if (parts.length === 1 && parts[0].type === 'text' && !parts[0].text.startsWith('[附件')) {
      return parts[0].text;
    }
    return parts;
  },
};
