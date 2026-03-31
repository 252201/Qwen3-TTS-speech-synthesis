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
  referenceAudio?: string; // Base64 encoded audio
  referenceAudioName?: string;
}
