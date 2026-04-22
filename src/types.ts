export interface TTSHistoryItem {
  id: string;
  text: string;
  timestamp: number;
  audioUrl: string;
  durationSeconds?: number;
  model: string;
  voice: string;
  seed?: number;
  responseFormat?: string;
  gain?: number;
  instruct?: string;
  isCloned?: boolean;
}

export interface TTSConfig {
  modelId: string;
  voice: string;
  instruct?: string;
  responseFormat: string;
  gain: number; // Output audio gain applied to the generated file before saving
  referenceAudio?: string; // Base64 Data URL for local preview
  referenceAudioRaw?: string; // Pure base64 string (no data: prefix) for API
  referenceAudioName?: string;
  referenceText?: string; // Transcript of reference audio (required by omlx v0.3.5)
}
