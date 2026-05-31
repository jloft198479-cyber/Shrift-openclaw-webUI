const MODEL_PREFIX = 'openclaw/';

const Api = {
  _abortController: null,

  /**
   * 直接对话模式 — 消息发给指定 agent（或 main）
   * 走 /v1/chat/completions + x-openclaw-agent-id 路由
   */
  chat: async function (messages, agentId, callbacks) {
    if (this._abortController) {
      throw new Error('Previous request still in progress');
    }
    this._abortController = new AbortController();

    const onDelta = callbacks.onDelta || function () {};
    const onDone = callbacks.onDone || function () {};
    const onError = callbacks.onError || function () {};
    const onThinking = callbacks.onThinking || function () {};
    const onAgentSwitch = callbacks.onAgentSwitch || function () {};
    const onToolCall = callbacks.onToolCall || function () {};

    const model = agentId ? MODEL_PREFIX + agentId : MODEL_PREFIX + 'main';

    try {
      const fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: true,
        }),
        signal: this._abortController.signal,
      };

      if (agentId) {
        fetchOpts.headers['x-openclaw-agent-id'] = agentId;
      }
      const currentSid = State.currentSessionId || '';
      fetchOpts.headers['x-openclaw-session-key'] = 'agent:' + (agentId || 'main') + ':webui' + (currentSid ? ':' + currentSid : '');

      const res = await fetch('/v1/chat/completions', fetchOpts);

      if (!res.ok) {
        let errText = '';
        try {
          errText = await res.text();
        } catch (e) {}
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.slice(0, 200) : ''));
      }

      State.setState({ connected: true });

      const contentType = res.headers.get('content-type') || '';
      const isSSE = contentType.indexOf('text/event-stream') >= 0;

      if (!isSSE) {
        const json = await res.json();
        const choice = json.choices && json.choices[0];
        if (choice && choice.message && choice.message.content) {
          onDelta(choice.message.content);
        }
        if (choice && choice.message && choice.message.reasoning_content) {
          onThinking(choice.message.reasoning_content);
        }
        let nonStreamAgent = agentId || '';
        if (json.model && json.model.indexOf(MODEL_PREFIX) === 0) {
          nonStreamAgent = json.model.slice(MODEL_PREFIX.length) || nonStreamAgent;
        }
        onDone(nonStreamAgent);
        this._abortController = null;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastModelAgent = agentId || '';
      let pendingToolCalls = {};

      while (true) {
        const result = await reader.read();
        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        let lines = buffer.split('\n');
        buffer = lines.pop();

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              onDone(lastModelAgent);
              this._abortController = null;
              return;
            }
            try {
              const json = JSON.parse(data);
              if (json.model && json.model.indexOf(MODEL_PREFIX) === 0) {
          const switchedAgent = json.model.slice(MODEL_PREFIX.length);
                if (switchedAgent && switchedAgent !== lastModelAgent && switchedAgent !== 'main') {
                  lastModelAgent = switchedAgent;
                  onAgentSwitch(switchedAgent);
                }
              }
              const choice = json.choices && json.choices[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (delta) {
                if (delta.content) {
                  onDelta(delta.content);
                }
                if (delta.reasoning_content) {
                  onThinking(delta.reasoning_content);
                }
                if (delta.tool_calls) {
                  delta.tool_calls.forEach(function (tc) {
                    const idx = tc.index;
                    if (!pendingToolCalls[idx]) {
                      pendingToolCalls[idx] = { id: tc.id || '', function: { name: '', arguments: '' } };
                    }
                    if (tc.id) pendingToolCalls[idx].id = tc.id;
                    if (tc.function) {
                      if (tc.function.name) pendingToolCalls[idx].function.name += tc.function.name;
                      if (tc.function.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
                    }
                  });
                }
              }

              if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                Object.keys(pendingToolCalls).forEach(function (idx) {
                  const tc = pendingToolCalls[idx];
                  if (tc.function.name) {
                    onToolCall(tc.function.name, tc.function.arguments, tc.id);
                  }
                });
                pendingToolCalls = {};
              }

              if (choice.finish_reason === 'stop') {
                onDone(lastModelAgent);
                this._abortController = null;
                return;
              }
            } catch (parseErr) { console.warn('[Api] SSE parse skip:', parseErr.message || parseErr); }
          }
        }
      }

      onDone(lastModelAgent);
    } catch (err) {
      if (err.name === 'AbortError') {
        onDone(agentId || '');
        return;
      }
      onError(err);
    } finally {
      this._abortController = null;
    }
  },

  stopGeneration: function () {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  },

  fetchAgents: async function () {
    const data = await this._fetch('/api/agents');
    const normalized = normalizeAgents(data);
    State.setState({ agents: normalized });
    return normalized;
  },

  createAgent: async function (data) {
    await this._fetch('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await this.fetchAgents();
  },

  updateAgent: async function (agentId, data) {
    const body = { name: data.name, description: data.description, avatar: data.avatar, model: data.model };
    if (data.skills !== undefined) body.skills = data.skills;
    const tasks = [];
    tasks.push(this._fetch('/api/agents/' + encodeURIComponent(agentId), {
      method: 'PUT',
      body: JSON.stringify(body),
    }));
    if (data.prompt !== undefined) {
      tasks.push(this._fetch('/api/agents/' + encodeURIComponent(agentId) + '/agents-md', {
        method: 'PUT',
        body: JSON.stringify({ content: data.prompt }),
      }));
    }
    if (data.toolsMd !== undefined) {
      tasks.push(this._fetch('/api/agents/' + encodeURIComponent(agentId) + '/tools-md', {
        method: 'PUT',
        body: JSON.stringify({ content: data.toolsMd }),
      }));
    }
    await Promise.all(tasks);
    await this.fetchAgents();
  },

  fetchAgentDetail: async function (agentId) {
    return await this._fetch('/api/agents/' + encodeURIComponent(agentId));
  },

  fetchAllSkills: async function () {
    const data = await this._fetch('/api/skills');
    State.setState({ skills: data });
    return data;
  },

  fetchModels: async function () {
    const data = await this._fetch('/api/models');
    State.setState({ models: data.models || [], defaultModel: data.defaultModel || '' });
    return data;
  },

  updateDefaultModel: async function (modelId) {
    await this._fetch('/api/models/default', {
      method: 'PUT',
      body: JSON.stringify({ model: modelId }),
    });
    State.setState({ defaultModel: modelId });
  },

  checkHealth: async function () {
    try {
      const data = await this._fetch('/api/health');
      const online = data.gateway === 'online';
      State.setState({ connected: online });
      return online;
    } catch (e) {
      State.setState({ connected: false });
      return false;
    }
  },

  fetchSessionMessages: function (sessionId, callback) {
    fetch('/api/sessions/' + encodeURIComponent(sessionId))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (callback) callback(data.messages || []);
      })
      .catch(function () {
        if (callback) callback([]);
      });
  },

  _fetch: async function (url, opts) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      const res = await fetch(url, Object.assign({
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }, opts || {}));
      if (!res.ok) {
        let errBody = '';
        try { errBody = await res.text(); } catch (e) {}
        throw new Error('HTTP ' + res.status + (errBody ? ': ' + errBody.slice(0, 200) : ''));
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },
};
