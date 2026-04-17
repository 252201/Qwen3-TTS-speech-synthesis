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

export interface AudioEndingAnalysis {
  duration: number;
  tailRms: number;
  tailRatio: number;
}

export async function inspectAudioBlob(blob: Blob): Promise<AudioEndingAnalysis | null> {
  let audioCtx: AudioContext | null = null;

  try {
    const arrayBuffer = await blob.arrayBuffer();
    audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const windowSize = Math.max(1, Math.floor(audioBuffer.sampleRate * 0.12));
    const tailStart = Math.max(0, audioBuffer.length - windowSize);
    const prevStart = Math.max(0, tailStart - windowSize);
    const tailRms = getMonoRms(audioBuffer, tailStart, audioBuffer.length - tailStart);
    const prevRms = getMonoRms(audioBuffer, prevStart, tailStart - prevStart);

    return {
      duration: audioBuffer.duration,
      tailRms,
      tailRatio: prevRms > 0 ? tailRms / prevRms : tailRms > 0 ? Infinity : 1
    };
  } catch (error) {
    console.warn('Failed to inspect generated audio', error);
    return null;
  } finally {
    if (audioCtx) {
      await audioCtx.close();
    }
  }
}

export async function repairAbruptEnding(
  blob: Blob,
  analysis: AudioEndingAnalysis | null = null
): Promise<{ blob: Blob; repaired: boolean; analysis: AudioEndingAnalysis | null }> {
  const resolvedAnalysis = analysis ?? await inspectAudioBlob(blob);
  if (!resolvedAnalysis || !isAbruptEnding(resolvedAnalysis)) {
    return { blob, repaired: false, analysis: resolvedAnalysis };
  }

  let audioCtx: AudioContext | null = null;

  try {
    const arrayBuffer = await blob.arrayBuffer();
    audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const fadeSamples = Math.max(1, Math.floor(audioBuffer.sampleRate * 0.18));
    const silenceSamples = Math.max(1, Math.floor(audioBuffer.sampleRate * 0.12));
    const outputLength = audioBuffer.length + silenceSamples;
    const outputChannels: Float32Array[] = [];

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const input = audioBuffer.getChannelData(ch);
      const output = new Float32Array(outputLength);
      output.set(input, 0);

      const fadeStart = Math.max(0, audioBuffer.length - fadeSamples);
      const fadeSpan = Math.max(1, audioBuffer.length - fadeStart);

      for (let i = 0; i < fadeSpan; i++) {
        const progress = i / fadeSpan;
        const envelope = Math.pow(1 - progress, 1.6);
        output[fadeStart + i] = input[fadeStart + i] * envelope;
      }

      outputChannels.push(output);
    }

    const repairedBlob = new Blob(
      [encodeWavChannels(outputChannels, audioBuffer.sampleRate)],
      { type: 'audio/wav' }
    );

    return {
      blob: repairedBlob,
      repaired: true,
      analysis: await inspectAudioBlob(repairedBlob)
    };
  } catch (error) {
    console.warn('Failed to repair abrupt audio ending', error);
    return { blob, repaired: false, analysis: resolvedAnalysis };
  } finally {
    if (audioCtx) {
      await audioCtx.close();
    }
  }
}

export function getResponseFormatFromMimeType(mimeType?: string | null): string | undefined {
  if (!mimeType) return undefined;

  const normalized = mimeType.toLowerCase();

  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('opus') || normalized.includes('ogg')) return 'opus';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('flac')) return 'flac';

  return undefined;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  return encodeWavChannels([samples], sampleRate);
}

function encodeWavChannels(channelDataList: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = Math.max(1, channelDataList.length);
  const numSamples = channelDataList[0]?.length ?? 0;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channel = channelDataList[ch] ?? channelDataList[0];
      const s = Math.max(-1, Math.min(1, channel[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return buffer;
}

function isAbruptEnding(analysis: AudioEndingAnalysis): boolean {
  return analysis.tailRms > 0.035 && analysis.tailRatio > 1.15;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function getMonoRms(audioBuffer: AudioBuffer, startFrame: number, frameCount: number): number {
  if (frameCount <= 0) return 0;

  let sumSquares = 0;
  const endFrame = Math.min(audioBuffer.length, startFrame + frameCount);
  const channelCount = audioBuffer.numberOfChannels;

  for (let frame = startFrame; frame < endFrame; frame++) {
    let sample = 0;
    for (let ch = 0; ch < channelCount; ch++) {
      sample += audioBuffer.getChannelData(ch)[frame] / channelCount;
    }
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / Math.max(1, endFrame - startFrame));
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
