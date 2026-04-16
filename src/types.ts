export interface TTSHistoryItem {
  id: string;
  text: string;
  timestamp: number;
  audioUrl: string;
  model: string;
  voice: string;
  speed: number;
  seed: number;
  instruct?: string;
  isCloned?: boolean;
}

export interface TTSConfig {
  apiKey: string;
  apiHost: string;
  modelId: string;
  voice: string;
  speed: number;
  seed: number;
  instruct?: string;
  responseFormat: string;
  referenceAudio?: string; // Base64 Data URL for local preview
  referenceAudioRaw?: string; // Pure base64 string (no data: prefix) for API
  referenceAudioName?: string;
  referenceText?: string; // Transcript of reference audio (required by omlx v0.3.5)
}
