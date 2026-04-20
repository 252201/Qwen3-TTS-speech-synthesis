/**
 * Convert any browser-decodable audio file to WAV format using Web Audio API.
 * This ensures compatibility with omlx's voice cloning backend which expects WAV.
 */
export async function convertToWav(file: File): Promise<{ wavBlob: Blob; rawBase64: string }> {
  const audioBuffer = await decodeMediaFileToAudioBuffer(file);

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

async function decodeMediaFileToAudioBuffer(file: File): Promise<AudioBuffer> {
  const audioCtx = new AudioContext({ sampleRate: 24000 });

  try {
    const arrayBuffer = await file.arrayBuffer();
    const directBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    await audioCtx.close();
    return directBuffer;
  } catch (error) {
    await audioCtx.close();

    if (!file.type.startsWith('video/')) {
      throw error;
    }

    return extractAudioBufferFromVideo(file);
  }
}

async function extractAudioBufferFromVideo(file: File): Promise<AudioBuffer> {
  const objectUrl = URL.createObjectURL(file);
  const media = document.createElement('video');
  media.preload = 'auto';
  media.playsInline = true;
  media.src = objectUrl;
  media.crossOrigin = 'anonymous';

  const playbackCtx = new AudioContext({ sampleRate: 24000 });
  const source = playbackCtx.createMediaElementSource(media);
  const processor = playbackCtx.createScriptProcessor(4096, 2, 2);
  const zeroGain = playbackCtx.createGain();
  zeroGain.gain.value = 0;

  const channelChunks: Float32Array[][] = [];
  let channelCount = 0;
  let totalFrames = 0;

  processor.onaudioprocess = (event) => {
    const inputBuffer = event.inputBuffer;
    channelCount = Math.max(channelCount, inputBuffer.numberOfChannels);

    for (let ch = 0; ch < inputBuffer.numberOfChannels; ch++) {
      if (!channelChunks[ch]) channelChunks[ch] = [];
      channelChunks[ch].push(new Float32Array(inputBuffer.getChannelData(ch)));
    }

    totalFrames += inputBuffer.length;
  };

  source.connect(processor);
  processor.connect(zeroGain);
  zeroGain.connect(playbackCtx.destination);

  const cleanup = async () => {
    processor.onaudioprocess = null;
    media.onloadedmetadata = null;
    media.onended = null;
    media.onerror = null;
    media.pause();
    source.disconnect();
    processor.disconnect();
    zeroGain.disconnect();
    URL.revokeObjectURL(objectUrl);
    if (playbackCtx.state !== 'closed') {
      await playbackCtx.close();
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve();
      media.onerror = () => reject(new Error('视频加载失败，无法提取音轨。'));
    });

    await playbackCtx.resume();

    await new Promise<void>(async (resolve, reject) => {
      media.onended = () => resolve();

      try {
        await media.play();
      } catch (error) {
        reject(new Error('视频播放失败，无法提取音轨。'));
      }
    });

    if (channelCount === 0 || totalFrames === 0) {
      throw new Error('未能从视频中提取到有效音轨。');
    }

    const outputBuffer = playbackCtx.createBuffer(channelCount, totalFrames, playbackCtx.sampleRate);

    for (let ch = 0; ch < channelCount; ch++) {
      const outputChannel = outputBuffer.getChannelData(ch);
      const chunks = channelChunks[ch] || [];
      let offset = 0;

      for (const chunk of chunks) {
        outputChannel.set(chunk, offset);
        offset += chunk.length;
      }
    }

    return outputBuffer;
  } finally {
    await cleanup();
  }
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

export async function appendTrailingSilence(audioBlob: Blob, silenceSeconds: number): Promise<Blob> {
  if (silenceSeconds <= 0) return audioBlob;

  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const silenceSamples = Math.max(1, Math.floor(audioBuffer.sampleRate * silenceSeconds));
  const outputChannels: Float32Array[] = [];

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const input = audioBuffer.getChannelData(ch);
    const output = new Float32Array(input.length + silenceSamples);
    output.set(input, 0);
    outputChannels.push(output);
  }

  const wavBuffer = encodeWavChannels(outputChannels, audioBuffer.sampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
