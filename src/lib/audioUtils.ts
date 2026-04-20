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
  const mimeType = pickRecorderMimeType();
  if (!mimeType) {
    throw new Error('当前浏览器不支持从视频中提取音轨，请先导出音频后再上传。');
  }

  const objectUrl = URL.createObjectURL(file);
  const media = document.createElement('video');
  media.preload = 'auto';
  media.playsInline = true;
  media.muted = true;
  media.volume = 0;
  media.src = objectUrl;

  const playbackCtx = new AudioContext();
  const source = playbackCtx.createMediaElementSource(media);
  const destination = playbackCtx.createMediaStreamDestination();
  source.connect(destination);

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(destination.stream, { mimeType });

  const cleanup = async () => {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    media.onloadedmetadata = null;
    media.onended = null;
    media.onerror = null;
    source.disconnect();
    destination.disconnect();
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

    const recordedBlob = await new Promise<Blob>(async (resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error('视频音轨提取失败，请改用音频文件上传。'));
      media.onended = () => recorder.stop();

      recorder.start();

      try {
        await media.play();
      } catch (error) {
        recorder.stop();
        reject(new Error('视频播放失败，无法提取音轨。'));
        return;
      }

      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    const decodeCtx = new AudioContext({ sampleRate: 24000 });
    try {
      const arrayBuffer = await recordedBlob.arrayBuffer();
      return await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      await decodeCtx.close();
    }
  } finally {
    await cleanup();
  }
}

function pickRecorderMimeType(): string | null {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac'
  ];

  for (const mimeType of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
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
