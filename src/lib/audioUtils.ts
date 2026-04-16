/**
 * Convert any browser-decodable audio file to WAV format using Web Audio API.
 * This ensures compatibility with omlx's voice cloning backend which expects WAV.
 */
export async function convertToWav(file: File): Promise<{ wavBlob: Blob; rawBase64: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 24000 }); // 24kHz matches TTS models
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  // Downmix to mono
  const numSamples = audioBuffer.length;
  const mono = new Float32Array(numSamples);
  const numChannels = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      mono[i] += channelData[i] / numChannels;
    }
  }

  // Encode as 16-bit PCM WAV
  const wavBuffer = encodeWav(mono, audioBuffer.sampleRate);
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

  // Convert to pure base64 string
  const base64 = await blobToBase64Raw(wavBlob);

  return { wavBlob, rawBase64: base64 };
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const dataLength = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // PCM samples — clamp to [-1, 1] then scale to int16
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

async function blobToBase64Raw(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Apply gain (volume adjustment) to an audio blob by decoding, scaling PCM samples, and re-encoding as WAV.
 * gain: 0.25 = very quiet, 1.0 = unchanged, 3.0 = very loud
 */
export async function applyGain(audioBlob: Blob, gain: number): Promise<Blob> {
  if (gain === 1.0) return audioBlob; // No processing needed

  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  // Apply gain to each channel's PCM data
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;

  // Mix to mono and apply gain
  const mono = new Float32Array(numSamples);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      mono[i] += (channelData[i] * gain) / numChannels;
    }
  }

  // Clamp to [-1, 1]
  for (let i = 0; i < numSamples; i++) {
    mono[i] = Math.max(-1, Math.min(1, mono[i]));
  }

  // Re-encode as WAV
  const wavBuffer = encodeWav(mono, sampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
