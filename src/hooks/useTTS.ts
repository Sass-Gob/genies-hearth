import { useState, useCallback, useEffect } from 'react';

function stripForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')     // bold
    .replace(/\*(.*?)\*/g, '$1')         // italic
    .replace(/\[.*?\]\(.*?\)/g, '')      // links
    .replace(/#{1,6}\s/g, '')            // headers
    .replace(/\[whispers?\]/gi, '')      // expressive tags
    .replace(/\[laughs?\]/gi, '')
    .replace(/\[sighs?\]/gi, '')
    .replace(/\[growls?\]/gi, '')
    .replace(/\[purrs?\]/gi, '')
    .trim();
}

export function useTTS() {
  const hasBrowserTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = useCallback((text: string, msgId?: string) => {
    if (!hasBrowserTTS) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(stripForSpeech(text));

    // Load saved voice
    const savedVoiceName = localStorage.getItem('hearth-tts-voice');
    if (savedVoiceName) {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.name === savedVoiceName);
      if (voice) utterance.voice = voice;
    }

    utterance.rate = parseFloat(localStorage.getItem('hearth-tts-rate') || '1.0');
    utterance.pitch = parseFloat(localStorage.getItem('hearth-tts-pitch') || '1.0');

    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);

    setSpeakingMsgId(msgId || 'unknown');
    window.speechSynthesis.speak(utterance);
  }, [hasBrowserTTS]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeakingMsgId(null);
  }, []);

  return { speak, stop, speakingMsgId, hasBrowserTTS };
}
