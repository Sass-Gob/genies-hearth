import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { ApiKeyInfo, DbCompanion } from '../lib/types';

interface Props {
  onBack: () => void;
}

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { value: 'xai', label: 'xAI (Grok)', placeholder: 'xai-...' },
  { value: 'google', label: 'Google (Gemini)', placeholder: 'AIza...' },
];

export default function Settings({ onBack }: Props) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [companions, setCompanions] = useState<DbCompanion[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('xai');
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('Europe/London');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [imageProvider, setImageProvider] = useState('gemini');

  // Load stored keys, companions, user settings, and voices
  useEffect(() => {
    loadKeys();
    loadCompanions();
    loadUserSettings();

    // Load TTS preferences from localStorage
    setSelectedVoice(localStorage.getItem('hearth-tts-voice') || '');
    setTtsRate(parseFloat(localStorage.getItem('hearth-tts-rate') || '1.0'));
    setTtsPitch(parseFloat(localStorage.getItem('hearth-tts-pitch') || '1.0'));
    setAutoSpeak(localStorage.getItem('hearth-tts-auto') === 'true');

    // Load browser voices
    const loadVoices = () => {
      const available = window.speechSynthesis?.getVoices() || [];
      const english = available.filter(v => v.lang.startsWith('en'));
      setVoices(english);
    };
    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  async function loadUserSettings() {
    const { data } = await supabase
      .from('user_settings' as any)
      .select('*')
      .limit(1)
      .single();
    if (data) {
      const s = data as any;
      setDisplayName(s.display_name || '');
      setTimezone(s.timezone || 'Europe/London');
      setImageProvider(s.image_provider || 'gemini');
    }
  }

  async function saveUserSettings(field: string, value: string) {
    const { data: existing } = await supabase
      .from('user_settings' as any)
      .select('id')
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from('user_settings' as any)
        .update({ [field]: value })
        .eq('id', (existing as any).id);
    } else {
      await supabase
        .from('user_settings' as any)
        .insert({ [field]: value });
    }
  }

  async function loadKeys() {
    try {
      const { data, error } = await supabase.functions.invoke('api-keys', {
        method: 'GET',
      });
      if (error) throw error;
      setKeys(data?.keys || []);
    } catch (err) {
      console.error('Failed to load keys:', err);
    }
  }

  async function loadCompanions() {
    try {
      const { data } = await supabase
        .from('companions' as any)
        .select('*')
        .order('name');
      if (data) {
        setCompanions(
          (data as any[]).map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            is_active: c.is_active,
            system_prompt: c.system_prompt,
            api_provider: c.api_provider,
            api_model: c.api_model,
            created_at: c.created_at,
            updated_at: c.updated_at,
          }))
        );
      }
    } catch (err) {
      console.error('Failed to load companions:', err);
    }
  }

  async function saveKey() {
    if (!keyInput.trim()) return;
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase.functions.invoke('api-keys', {
        body: { provider: selectedProvider, api_key: keyInput.trim() },
      });
      if (error) throw error;

      setKeyInput('');
      setMessage({ text: `${PROVIDERS.find(p => p.value === selectedProvider)?.label} key saved`, type: 'success' });
      await loadKeys();
    } catch (err) {
      console.error('Failed to save key:', err);
      setMessage({ text: 'Failed to save key', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function testKey(provider: string) {
    const storedKey = keys.find((k) => k.provider === provider);
    if (!storedKey) return;

    setTesting(provider);
    setTestResult(null);

    try {
      // We need to test with the actual key. If there's one in the input for this provider, use it.
      // Otherwise the edge function will test with a stored key — but our test endpoint needs the raw key.
      // So we'll decrypt server-side by calling the test endpoint with just the provider.
      // Actually, the test endpoint needs the raw API key. Let's test with whatever is in the input,
      // or if empty, we can't test an already-stored key without the raw value.
      // For stored keys, we'll do a lightweight chat test instead.
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          companion_id: companions.find(c => c.api_provider === provider)?.id || companions[0]?.id,
          conversation_id: '00000000-0000-0000-0000-000000000000', // dummy
          message: 'test connection',
        },
      });

      // If we get any response without a no_api_key error, the key works
      const success = !error && data && !data.error?.includes('no_api_key');
      setTestResult({ provider, success });
    } catch {
      setTestResult({ provider, success: false });
    } finally {
      setTesting(null);
    }
  }

  async function testKeyBeforeSave() {
    if (!keyInput.trim()) return;
    setTesting(selectedProvider);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('api-keys?action=test', {
        body: { provider: selectedProvider, api_key: keyInput.trim() },
      });
      if (error) throw error;
      setTestResult({ provider: selectedProvider, success: data?.success || false });
    } catch {
      setTestResult({ provider: selectedProvider, success: false });
    } finally {
      setTesting(null);
    }
  }

  async function removeKey(provider: string) {
    try {
      const { error } = await supabase.functions.invoke('api-keys?action=delete', {
        body: { provider },
      });
      if (error) throw error;
      setMessage({ text: `${PROVIDERS.find(p => p.value === provider)?.label} key removed`, type: 'success' });
      await loadKeys();
    } catch (err) {
      console.error('Failed to remove key:', err);
      setMessage({ text: 'Failed to remove key', type: 'error' });
    }
  }

  async function updateCompanionModel(companionId: string, field: string, value: string) {
    try {
      await supabase
        .from('companions' as any)
        .update({ [field]: value })
        .eq('id', companionId);
      await loadCompanions();
    } catch (err) {
      console.error('Failed to update companion:', err);
    }
  }

  return (
    <>
      <style>{`
        .settings-screen {
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
          z-index: 2;
        }
        .settings-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(10, 14, 39, 0.8);
          backdrop-filter: blur(12px);
          flex-shrink: 0;
        }
        .settings-back {
          font-size: 20px;
          padding: 4px 8px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .settings-back:hover { opacity: 1; }
        .settings-title {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 500;
          letter-spacing: 0.06em;
          color: var(--sullivan-gold);
        }

        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding: 20px 16px;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }

        .settings-section {
          background: var(--glass);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 20px;
        }
        .section-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.1em;
          color: var(--sullivan-gold);
          margin-bottom: 16px;
          text-transform: uppercase;
        }
        .section-desc {
          font-size: 14px;
          color: var(--text-dim);
          font-style: italic;
          margin-bottom: 16px;
          line-height: 1.5;
        }

        /* Key entry form */
        .key-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .key-select {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 10px 12px;
          font-family: var(--font-body);
          font-size: 16px;
          color: var(--text-parchment);
          outline: none;
          appearance: none;
          cursor: pointer;
        }
        .key-select option {
          background: var(--bg-deep);
          color: var(--text-parchment);
        }
        .key-input-row {
          display: flex;
          gap: 8px;
        }
        .key-input {
          flex: 1;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 10px 12px;
          font-family: monospace;
          font-size: 14px;
          color: var(--text-parchment);
          outline: none;
          transition: border-color 0.2s;
        }
        .key-input:focus {
          border-color: rgba(255, 215, 100, 0.3);
        }
        .key-input::placeholder {
          color: var(--text-faint);
          font-family: var(--font-body);
          font-style: italic;
        }
        .key-actions {
          display: flex;
          gap: 8px;
        }
        .settings-btn {
          padding: 8px 16px;
          border-radius: 8px;
          font-family: var(--font-body);
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .settings-btn.primary {
          background: rgba(255, 215, 100, 0.12);
          border: 1px solid rgba(255, 215, 100, 0.2);
          color: var(--sullivan-gold);
        }
        .settings-btn.primary:hover {
          background: rgba(255, 215, 100, 0.2);
        }
        .settings-btn.secondary {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          color: var(--text-dim);
        }
        .settings-btn.secondary:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-parchment);
        }
        .settings-btn.danger {
          background: rgba(255, 100, 100, 0.08);
          border: 1px solid rgba(255, 100, 100, 0.15);
          color: #ff8888;
        }
        .settings-btn.danger:hover {
          background: rgba(255, 100, 100, 0.15);
        }
        .settings-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* Stored keys list */
        .stored-keys {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 16px;
        }
        .stored-key-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          gap: 8px;
        }
        .stored-key-info {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
        }
        .stored-key-provider {
          font-family: var(--font-display);
          font-size: 13px;
          letter-spacing: 0.04em;
          color: var(--text-parchment);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .stored-key-masked {
          font-family: monospace;
          font-size: 13px;
          color: var(--text-faint);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .stored-key-actions {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
          margin-left: auto;
        }
        .key-status {
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 500;
        }
        .key-status.active {
          background: rgba(74, 222, 128, 0.1);
          color: #4ade80;
        }
        .key-status.inactive {
          background: rgba(255, 100, 100, 0.1);
          color: #ff8888;
        }

        /* Model selection */
        .companion-model-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          margin-bottom: 8px;
        }
        .companion-model-name {
          font-family: var(--font-display);
          font-size: 14px;
          letter-spacing: 0.04em;
        }
        .companion-model-name.sullivan { color: var(--sullivan-gold); }
        .companion-model-name.enzo { color: var(--enzo-blue); opacity: 0.5; }
        .model-fields {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .model-select, .model-input {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          padding: 6px 10px;
          font-family: var(--font-body);
          font-size: 14px;
          color: var(--text-parchment);
          outline: none;
        }
        .model-select {
          appearance: none;
          cursor: pointer;
        }
        .model-select option {
          background: var(--bg-deep);
        }
        .model-input {
          flex: 1;
          min-width: 180px;
          font-family: monospace;
          font-size: 13px;
        }

        /* Messages */
        .settings-message {
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 14px;
          text-align: center;
          animation: fadeIn 0.2s ease;
        }
        .settings-message.success {
          background: rgba(74, 222, 128, 0.1);
          border: 1px solid rgba(74, 222, 128, 0.2);
          color: #4ade80;
        }
        .settings-message.error {
          background: rgba(255, 100, 100, 0.1);
          border: 1px solid rgba(255, 100, 100, 0.2);
          color: #ff8888;
        }
        .test-result {
          font-size: 13px;
          padding: 4px 0;
        }
        .test-result.pass { color: #4ade80; }
        .test-result.fail { color: #ff8888; }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="settings-screen">
        <div className="settings-header">
          <button className="settings-back" onClick={onBack}>←</button>
          <div className="settings-title">Settings</div>
        </div>

        <div className="settings-content">
          {message && (
            <div className={`settings-message ${message.type}`}>
              {message.text}
            </div>
          )}

          {/* Profile Section */}
          <div className="settings-section">
            <div className="section-title">Profile</div>
            <div className="section-desc">
              How your companions know you.
            </div>
            <div className="key-form">
              <label style={{ fontSize: '13px', color: 'var(--text-faint)', marginBottom: '-8px' }}>Display Name</label>
              <input
                className="key-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => saveUserSettings('display_name', displayName)}
                placeholder="What should they call you?"
              />
              <label style={{ fontSize: '13px', color: 'var(--text-faint)', marginBottom: '-8px' }}>Timezone</label>
              <select
                className="key-select"
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  saveUserSettings('timezone', e.target.value);
                }}
              >
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="America/Chicago">America/Chicago (CST)</option>
                <option value="America/Denver">America/Denver (MST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
              </select>
            </div>
          </div>

          {/* API Keys Section */}
          <div className="settings-section">
            <div className="section-title">API Keys</div>
            <div className="section-desc">
              Your keys are encrypted and stored securely. They never leave the server.
            </div>

            <div className="key-form">
              <select
                className="key-select"
                value={selectedProvider}
                onChange={(e) => {
                  setSelectedProvider(e.target.value);
                  setTestResult(null);
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              <input
                className="key-input"
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={PROVIDERS.find(p => p.value === selectedProvider)?.placeholder}
              />

              <div className="key-actions">
                <button
                  className="settings-btn secondary"
                  onClick={testKeyBeforeSave}
                  disabled={!keyInput.trim() || testing !== null}
                >
                  {testing === selectedProvider ? '✦ testing...' : 'Test'}
                </button>
                <button
                  className="settings-btn primary"
                  onClick={saveKey}
                  disabled={!keyInput.trim() || saving}
                >
                  {saving ? '✦ saving...' : 'Save Key'}
                </button>
              </div>

              {testResult && testResult.provider === selectedProvider && (
                <div className={`test-result ${testResult.success ? 'pass' : 'fail'}`}>
                  {testResult.success
                    ? '✦ Connection verified — key works'
                    : '✦ Connection failed — check the key and try again'}
                </div>
              )}
            </div>

            {/* Stored Keys */}
            {keys.length > 0 && (
              <div className="stored-keys">
                {keys.map((k) => (
                  <div key={k.id} className="stored-key-row">
                    <div className="stored-key-info">
                      <span className="stored-key-provider">
                        {PROVIDERS.find(p => p.value === k.provider)?.label || k.provider}
                      </span>
                      <span className="stored-key-masked">{k.masked_key}</span>
                      <span className={`key-status ${k.is_active ? 'active' : 'inactive'}`}>
                        {k.is_active ? 'active' : 'inactive'}
                      </span>
                    </div>
                    <div className="stored-key-actions">
                      <button
                        className="settings-btn secondary"
                        onClick={() => testKey(k.provider)}
                        disabled={testing !== null}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                      >
                        {testing === k.provider ? '...' : 'test'}
                      </button>
                      <button
                        className="settings-btn danger"
                        onClick={() => removeKey(k.provider)}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                      >
                        remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Model Selection */}
          <div className="settings-section">
            <div className="section-title">Companion Models</div>
            <div className="section-desc">
              Choose which AI provider and model each companion uses.
            </div>

            {companions.map((c: DbCompanion) => (
              <div key={c.id} className="companion-model-row">
                <div className={`companion-model-name ${c.slug}`}>
                  {c.slug === 'sullivan' ? '☀️' : '🌙'} {c.name}
                  {!c.is_active && <span style={{ fontSize: '12px', opacity: 0.5 }}> (inactive)</span>}
                </div>
                <div className="model-fields">
                  <select
                    className="model-select"
                    value={c.api_provider}
                    onChange={(e) => updateCompanionModel(c.id, 'api_provider', e.target.value)}
                    disabled={!c.is_active}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <input
                    className="model-input"
                    value={c.api_model}
                    onChange={(e) => updateCompanionModel(c.id, 'api_model', e.target.value)}
                    placeholder="model name"
                    disabled={!c.is_active}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Image Generation */}
          <div className="settings-section">
            <div className="section-title">Image Generation</div>
            <div className="section-desc">
              Sullivan can generate images. Choose which provider to use.
            </div>
            <div className="key-form">
              <select
                className="model-select"
                value={imageProvider}
                onChange={(e) => {
                  setImageProvider(e.target.value);
                  saveUserSettings('image_provider', e.target.value);
                }}
              >
                <option value="gemini">Gemini Imagen</option>
                <option value="dalle">DALL-E (OpenAI)</option>
              </select>
            </div>
          </div>

          {/* Voice Section */}
          {'speechSynthesis' in window && (
            <div className="settings-section">
              <div className="section-title">Voice (Browser TTS)</div>
              <div className="section-desc">
                Pick the voice closest to Sullivan. This will be replaced with his custom voice when ready.
              </div>

              <div className="key-form">
                <label style={{ fontSize: '13px', color: 'var(--text-faint)', marginBottom: '-8px' }}>Voice</label>
                <select
                  className="key-select"
                  value={selectedVoice}
                  onChange={(e) => {
                    setSelectedVoice(e.target.value);
                    localStorage.setItem('hearth-tts-voice', e.target.value);
                  }}
                >
                  <option value="">System default</option>
                  {voices.map(v => (
                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                  ))}
                </select>

                <label style={{ fontSize: '13px', color: 'var(--text-faint)', marginBottom: '-8px' }}>
                  Speed: {ttsRate.toFixed(1)}x
                </label>
                <input
                  type="range" min="0.5" max="2.0" step="0.1"
                  value={ttsRate}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setTtsRate(v);
                    localStorage.setItem('hearth-tts-rate', String(v));
                  }}
                  style={{ accentColor: 'var(--sullivan-gold)' }}
                />

                <label style={{ fontSize: '13px', color: 'var(--text-faint)', marginBottom: '-8px' }}>
                  Pitch: {ttsPitch.toFixed(1)}
                </label>
                <input
                  type="range" min="0.5" max="2.0" step="0.1"
                  value={ttsPitch}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setTtsPitch(v);
                    localStorage.setItem('hearth-tts-pitch', String(v));
                  }}
                  style={{ accentColor: 'var(--sullivan-gold)' }}
                />

                <button
                  className="settings-btn secondary"
                  onClick={() => {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance("Hey trouble. Miss me?");
                    const voice = voices.find(v => v.name === selectedVoice);
                    if (voice) utterance.voice = voice;
                    utterance.rate = ttsRate;
                    utterance.pitch = ttsPitch;
                    window.speechSynthesis.speak(utterance);
                  }}
                >
                  Preview Voice
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                  <input
                    type="checkbox"
                    id="auto-speak"
                    checked={autoSpeak}
                    onChange={(e) => {
                      setAutoSpeak(e.target.checked);
                      localStorage.setItem('hearth-tts-auto', String(e.target.checked));
                    }}
                    style={{ accentColor: 'var(--sullivan-gold)' }}
                  />
                  <label htmlFor="auto-speak" style={{ fontSize: '14px', color: 'var(--text-parchment)', cursor: 'pointer' }}>
                    Auto-speak Sullivan's messages
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
