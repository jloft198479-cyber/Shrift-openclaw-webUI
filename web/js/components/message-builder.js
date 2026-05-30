/* ── message-builder.js — API 消息构建（纯函数，零 DOM 依赖）──── */

var _ATT_LINE_RE = /^[\U0001f5bc\U0001f4c4\U0001f4e6\U0001f4dd\U0001f4ca\U0001f4c3\U0001f4ce]\s/;
var MessageBuilder = {

  buildApiMessages: function (session, agentId, displayText, attachmentPaths) {
    var chatMessages = (session && session.messages) || [];
    var targetAgentId = agentId || 'main';
    var ap = attachmentPaths || [];

    var apiMessages = chatMessages.map(function (m) {
      if (m.role === 'assistant' && m.agentId && m.agentId !== targetAgentId) {
        var srcAgent = State.findAgent(m.agentId);
        var srcName = srcAgent ? (srcAgent.displayName || srcAgent.name) : m.agentId;
        return { role: 'assistant', content: '[' + srcName + ' said]: ' + m.content };
      }

      if (m.role === 'user' && m.attachments && m.attachments.length > 0) {
        return MessageBuilder.buildMultimodalMessage(m.content, m.attachments);
      }

      return { role: m.role, content: m.content };
    });

    if (apiMessages.length === 0) {
      if (ap.length > 0) {
        apiMessages = [{ role: 'user', content: MessageBuilder.buildMultimodalContent(displayText, ap) }];
      } else {
        apiMessages = [{ role: 'user', content: displayText }];
      }
    } else if (ap.length > 0) {
      var lastMsg = apiMessages[apiMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content = MessageBuilder.buildMultimodalContent(displayText, ap);
      }
    }

    return apiMessages;
  },

  buildAttachmentDisplayText: function (text, attachmentPaths) {
    if (!attachmentPaths || attachmentPaths.length === 0) return text;
    var attInfo = attachmentPaths.map(function (a) {
      var icon = a.type && a.type.indexOf('image/') === 0 ? '🖼' : '📄';
      return '\n' + icon + ' ' + (a.name || '附件');
    }).join('');
    return (text || '') + attInfo;
  },

  buildMultimodalMessage: function (textContent, attachments) {
    return { role: 'user', content: MessageBuilder.buildMultimodalContent(textContent, attachments) };
  },

  buildMultimodalContent: function (textContent, attachments) {
    var parts = [];

    var cleanText = (textContent || '').split('\n').filter(function (line) {
      return !_ATT_LINE_RE.test(line);
    }).join('\n').trim();
    if (cleanText) {
      parts.push({ type: 'text', text: cleanText });
    }

    for (var i = 0; i < attachments.length; i++) {
      var att = attachments[i];
      var isImage = att.type && att.type.indexOf('image/') === 0;
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
