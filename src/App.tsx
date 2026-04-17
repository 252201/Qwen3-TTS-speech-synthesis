/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Clock,
  Download,
  History,
  Loader2,
  Mic2,
  Play,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  Volume2,
  X
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { convertToWav } from './lib/audioUtils';
import { saveAudio, getAudio, deleteAudio } from './lib/db';
import { TTSConfig, TTSHistoryItem } from './types';

const DEFAULT_MODEL_ID = 'Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit';
const DEFAULT_CLONE_MODEL_ID = 'Qwen3-TTS-12Hz-1.7B-Base-8bit';

const DEFAULT_CONFIG: TTSConfig = {
  apiKey: import.meta.env.VITE_TTS_API_KEY || 'omlx-mpi54dic99snaxxp',
  apiHost: 'https://api.252202.xyz/v1/audio/speech',
  modelId: import.meta.env.VITE_TTS_MODEL_ID || DEFAULT_MODEL_ID,
  voice: 'vivian',
  speed: 1.0,
  seed: 42,
  responseFormat: 'mp3',
  gain: 1.0
};

const PRESET_VOICES = [
  { id: 'vivian', label: 'Vivian', description: '普通女声' },
  { id: 'serena', label: 'Serena', description: '活泼女声' },
  { id: 'uncle_fu', label: 'Uncle_Fu', description: '醇厚大叔' },
  { id: 'dylan', label: 'Dylan', description: '北京男声' },
  { id: 'eric', label: 'Eric', description: '成都男声' },
  { id: 'ryan', label: 'Ryan', description: '英文男声' },
  { id: 'aiden', label: 'Aiden', description: '美音男声' },
  { id: 'ono_anna', label: 'Anna', description: '日文女声' },
  { id: 'sohee', label: 'Sohee', description: '韩文女声' }
];

const EMOTION_PRESETS = [
  { val: 'Speak with excitement and high energy.', label: '开心兴奋', emoji: '😊' },
  { val: 'Speak in a sad, slow, and low-pitched voice.', label: '悲伤低沉', emoji: '😔' },
  { val: 'Speak with a strict, serious, and slightly angry tone.', label: '严肃生气', emoji: '😠' },
  { val: 'Speak softly, gently, and calmly like a whisper.', label: '温柔轻语', emoji: '🤫' },
  { val: 'Speak clearly and professionally like a news anchor.', label: '专业播音', emoji: '🎙️' },
  { val: 'Speak in a panicked and rushed tone.', label: '惊慌急促', emoji: '😰' }
];

const MODEL_PRESETS = [
  { id: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit', label: '1.7B-CustomVoice', note: '预设音色推荐' },
  { id: 'Qwen3-TTS-12Hz-1.7B-Base-8bit', label: '1.7B-Base', note: '语音克隆推荐' },
  { id: 'Qwen3.5-4B-MLX-8bit', label: 'Qwen3.5-4B-MLX', note: '通用语音模型' },
  { id: 'Qwen3.5-4B-DFlash', label: 'Qwen3.5-4B-DFlash', note: '接口返回可用' }
];

const PROMPT_SUGGESTIONS = [
  '欢迎来到今天的节目，我们将用两分钟快速了解这项新技术。',
  '请把这段广告词念得更温暖、更有亲和力，适合短视频口播。',
  '各位旅客您好，前方即将到达下一站，请提前做好下车准备。',
  '下面请听一段沉稳的品牌旁白，语速放慢一些，结尾稍微上扬。'
];

const RESPONSE_FORMATS = ['mp3', 'opus', 'aac', 'flac'];

function getModelsEndpoint(apiHost: string) {
  try {
    const url = new URL(apiHost);
    url.pathname = url.pathname.replace(/\/audio\/speech\/?$/, '/models');
    return url.toString();
  } catch {
    return apiHost.replace(/\/audio\/speech\/?$/, '/models');
  }
}

export default function App() {
  const [text, setText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<TTSHistoryItem[]>([]);
  const [config, setConfig] = useState<TTSConfig>(DEFAULT_CONFIG);
  const [availableModelIds, setAvailableModelIds] = useState<string[]>([]);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configLoaded = useRef(false);

  useEffect(() => {
    const savedConfig = localStorage.getItem('tts_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to parse config', e);
      }
    }
    configLoaded.current = true;

    const loadHistory = async () => {
      const savedHistory = localStorage.getItem('tts_history');
      if (!savedHistory) return;

      try {
        const parsed: TTSHistoryItem[] = JSON.parse(savedHistory);
        const hydrated = await Promise.all(parsed.map(async (item) => {
          const blob = await getAudio(item.id);
          if (!blob) return null;
          return { ...item, audioUrl: URL.createObjectURL(blob) };
        }));
        setHistory(hydrated.filter((item): item is TTSHistoryItem => item !== null));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    };

    loadHistory();
  }, []);

  useEffect(() => {
    localStorage.setItem('tts_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (!configLoaded.current) return;
    const { referenceAudio, referenceAudioRaw, referenceText, ...saveableConfig } = config;
    localStorage.setItem('tts_config', JSON.stringify(saveableConfig));
  }, [config]);

  useEffect(() => {
    if (config.gain >= 0.25 && config.gain <= 1) return;
    setConfig(prev => ({
      ...prev,
      gain: Math.min(1, Math.max(0.25, prev.gain || 1))
    }));
  }, [config.gain]);

  useEffect(() => {
    let cancelled = false;

    const loadAvailableModels = async () => {
      try {
        const response = await fetch(getModelsEndpoint(config.apiHost), {
          headers: {
            Authorization: `Bearer ${config.apiKey}`
          }
        });

        if (!response.ok) return;

        const payload = await response.json();
        const models = Array.isArray(payload?.data)
          ? payload.data.map((item: { id?: string }) => item.id).filter((id: string | undefined): id is string => !!id)
          : [];

        if (cancelled || models.length === 0) return;

        setAvailableModelIds(models);

        if (!models.includes(config.modelId)) {
          const preferredModel =
            models.find(id => id.includes('CustomVoice')) ||
            models[0];

          if (preferredModel) {
            setConfig(prev => (
              models.includes(prev.modelId)
                ? prev
                : { ...prev, modelId: preferredModel }
            ));
          }
        }
      } catch (error) {
        console.error('Failed to load available models', error);
      }
    };

    loadAvailableModels();

    return () => {
      cancelled = true;
    };
  }, [config.apiHost, config.apiKey, config.modelId]);

  useEffect(() => {
    if (!config.instruct?.trim()) return;
    if (config.modelId.includes('CustomVoice')) return;

    const preferredEmotionModel =
      availableModelIds.find(id => id.includes('CustomVoice')) ||
      DEFAULT_MODEL_ID;

    setConfig(prev => (
      prev.modelId.includes('CustomVoice')
        ? prev
        : { ...prev, modelId: preferredEmotionModel }
    ));
  }, [availableModelIds, config.instruct, config.modelId]);

  useEffect(() => {
    if (!(config.voice === 'custom' && config.referenceAudioRaw)) return;
    if (config.modelId.includes('Base')) return;

    const preferredCloneModel =
      availableModelIds.find(id => id.includes('1.7B-Base')) ||
      availableModelIds.find(id => id.includes('Base')) ||
      DEFAULT_CLONE_MODEL_ID;

    setConfig(prev => (
      prev.voice === 'custom' && prev.referenceAudioRaw && !prev.modelId.includes('Base')
        ? { ...prev, modelId: preferredCloneModel }
        : prev
    ));
  }, [availableModelIds, config.modelId, config.referenceAudioRaw, config.voice]);

  useEffect(() => {
    if (config.voice === 'custom' && config.referenceAudioRaw) return;
    if (config.modelId.includes('CustomVoice')) return;

    const preferredPresetModel =
      availableModelIds.find(id => id === DEFAULT_MODEL_ID) ||
      availableModelIds.find(id => id.includes('CustomVoice')) ||
      DEFAULT_MODEL_ID;

    setConfig(prev => (
      prev.voice !== 'custom' && !prev.referenceAudioRaw && !prev.modelId.includes('CustomVoice')
        ? { ...prev, modelId: preferredPresetModel }
        : prev
    ));
  }, [availableModelIds, config.modelId, config.referenceAudioRaw, config.voice]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('音频文件不能超过 5MB');
      return;
    }

    try {
      const { wavBlob, rawBase64 } = await convertToWav(file);
      const previewUrl = URL.createObjectURL(wavBlob);
      const cloneModel =
        availableModelIds.find(id => id.includes('1.7B-Base')) ||
        availableModelIds.find(id => id.includes('Base')) ||
        DEFAULT_CLONE_MODEL_ID;
      setConfig(prev => ({
        ...prev,
        referenceAudio: previewUrl,
        referenceAudioRaw: rawBase64,
        referenceAudioName: file.name,
        voice: 'custom',
        modelId: cloneModel
      }));
    } catch (err) {
      console.error('Audio conversion failed:', err);
      alert('音频文件解码失败，请尝试使用 WAV 格式的音频文件。');
    }
  };

  const clearReferenceAudio = () => {
    const presetModel =
      availableModelIds.find(id => id === DEFAULT_MODEL_ID) ||
      availableModelIds.find(id => id.includes('CustomVoice')) ||
      DEFAULT_MODEL_ID;

    setConfig(prev => ({
      ...prev,
      referenceAudio: undefined,
      referenceAudioRaw: undefined,
      referenceAudioName: undefined,
      referenceText: undefined,
      voice: DEFAULT_CONFIG.voice,
      modelId: presetModel
    }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!text.trim() || isGenerating) return;

    const requiresReferenceText =
      config.voice === 'custom' &&
      !!config.referenceAudioRaw &&
      /api\.252202\.xyz/i.test(config.apiHost);

    if (requiresReferenceText && !config.referenceText?.trim()) {
      alert('当前接口要求填写参考音频文本（ref_text），请填写参考音频中实际说的内容。');
      return;
    }

    setIsGenerating(true);
    try {
      const body: any = {
        model: config.modelId,
        input: text,
        voice: config.voice === 'custom' ? 'alloy' : config.voice,
        speed: config.speed,
        seed: config.seed,
        instruct: config.instruct,
        response_format: config.responseFormat
      };

      if (config.voice === 'custom' && config.referenceAudioRaw) {
        body.ref_audio = config.referenceAudioRaw;
        if (config.referenceText?.trim()) {
          body.ref_text = config.referenceText.trim();
        }
      }

      const response = await fetch(config.apiHost, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = '合成语音失败';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = `HTTP 错误 ${response.status}: ${errorText.slice(0, 100) || response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const newItemId = crypto.randomUUID();
      await saveAudio(newItemId, blob);
      const audioUrl = URL.createObjectURL(blob);

      const newItem: TTSHistoryItem = {
        id: newItemId,
        text,
        timestamp: Date.now(),
        audioUrl,
        model: config.modelId,
        voice: config.voice === 'custom' ? `克隆: ${config.referenceAudioName}` : config.voice,
        speed: config.speed,
        seed: config.seed,
        responseFormat: config.responseFormat,
        gain: config.gain,
        instruct: config.instruct,
        isCloned: config.voice === 'custom'
      };

      setHistory(prev => [newItem, ...prev]);
      setCurrentAudio(audioUrl);
      setText('');
    } catch (error) {
      console.error('Generation error:', error);
      alert(error instanceof Error ? error.message : 'An error occurred during generation');
    } finally {
      setIsGenerating(false);
    }
  };

  const playAudio = (item: TTSHistoryItem) => {
    if (!audioRef.current) return;

    if (currentAudio === item.audioUrl && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    audioRef.current.src = item.audioUrl;
    audioRef.current.playbackRate = item.speed || 1.0;
    audioRef.current.volume = Math.min(1, Math.max(0.25, item.gain || 1));
    audioRef.current.play();
    setCurrentAudio(item.audioUrl);
    setIsPlaying(true);
  };

  const downloadAudio = (item: TTSHistoryItem) => {
    const a = document.createElement('a');
    a.href = item.audioUrl;
    a.download = `qwen3-tts-${item.id.slice(0, 8)}.${item.responseFormat || 'mp3'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      await deleteAudio(id);
    } catch (e) {
      console.error('Failed to delete audio payload', e);
    }

    setHistory(prev => {
      const item = prev.find(entry => entry.id === id);
      if (item) URL.revokeObjectURL(item.audioUrl);
      return prev.filter(entry => entry.id !== id);
    });
  };

  const selectedVoice = PRESET_VOICES.find(voice => voice.id === config.voice);
  const selectedEmotion = EMOTION_PRESETS.find(preset => preset.val === config.instruct);
  const selectedModel = MODEL_PRESETS.find(model => model.id === config.modelId);
  const isCloneMode = config.voice === 'custom' && !!config.referenceAudioRaw;
  const estimatedSeconds = Math.max(3, Math.ceil(text.trim().length / 7));
  const isCurrentCompatHost = /api\.252202\.xyz/i.test(config.apiHost);
  const seedIsExperimental = isCurrentCompatHost;
  const referenceTextRequired = isCloneMode && isCurrentCompatHost;
  const cardClass =
    'rounded-[28px] border border-white/10 bg-white/6 shadow-[0_24px_80px_rgba(8,10,20,0.45)] backdrop-blur-xl';

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-[var(--accent)] selection:text-black">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(240,185,96,0.18),_transparent_32%),radial-gradient(circle_at_80%_10%,_rgba(73,128,255,0.18),_transparent_26%),linear-gradient(180deg,_rgba(14,18,34,0.85),_rgba(7,10,20,1))]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        <div className="absolute -left-16 top-24 h-64 w-64 rounded-full bg-[var(--accent)]/15 blur-3xl" />
        <div className="absolute bottom-10 right-0 h-72 w-72 rounded-full bg-[var(--accent-cool)]/15 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className={cn(cardClass, 'overflow-hidden')}>
          <div className="px-6 py-7 lg:px-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--panel-2)] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.32em] text-[var(--muted)]">
                  <Mic2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Broadcast Console
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-[var(--soft)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                  语音合成 + 语音克隆
                </span>
              </div>

              <div className="max-w-3xl space-y-4">
                <h1 className="max-w-4xl font-display text-4xl uppercase leading-none tracking-[0.06em] text-white sm:text-5xl xl:text-6xl">
                  Qwen3 TTS
                  <span className="mt-2 block font-serif text-[0.62em] normal-case italic tracking-normal text-[var(--accent)]">
                    Speech Synthesis Studio
                  </span>
                </h1>
              </div>

            </div>
          </div>
        </header>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
          <main className="space-y-8">
            <section className={cn(cardClass, 'overflow-hidden')}>
              <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:p-8">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="text-[11px] font-mono uppercase tracking-[0.32em] text-[var(--muted)]">
                        Script Editor
                      </div>
                      <h2 className="text-2xl font-semibold text-white sm:text-3xl">文本输入与实时生成</h2>
                      <p className="max-w-2xl text-sm leading-7 text-[var(--soft)]">
                        左边专注写稿，右边只保留关键信息卡。操作路径更短，也更适合边测试边改口播文案。
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[var(--soft)]">
                      当前输出:
                      <span className="ml-2 font-semibold text-white">{config.responseFormat.toUpperCase()}</span>
                    </div>
                  </div>

                  <div className="relative">
                    <div className="pointer-events-none absolute -inset-px rounded-[30px] bg-[linear-gradient(135deg,rgba(240,185,96,0.35),transparent_40%,rgba(73,128,255,0.2))] opacity-70" />
                    <div className="relative rounded-[30px] border border-white/10 bg-[rgba(8,11,20,0.92)] p-4 sm:p-5">
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="输入要合成的文本，例如广告口播、欢迎词、旁白、提醒播报..."
                        className="h-[320px] w-full resize-none rounded-[24px] border border-white/6 bg-[var(--panel)] px-5 py-5 text-base leading-8 text-white outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--line-strong)] sm:text-lg"
                      />

                      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="flex flex-wrap gap-2">
                          {PROMPT_SUGGESTIONS.map((prompt) => (
                            <button
                              key={prompt}
                              onClick={() => setText(prompt)}
                              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-[var(--soft)] transition hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)] hover:text-white"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono uppercase tracking-[0.22em] text-[var(--muted)]">
                            {text.length} chars
                          </div>
                          <button
                            onClick={handleGenerate}
                            disabled={!text.trim() || isGenerating}
                            className={cn(
                              'inline-flex min-w-[200px] items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition',
                              isGenerating
                                ? 'cursor-not-allowed bg-white/10 text-[var(--muted)]'
                                : 'bg-[linear-gradient(135deg,var(--accent),#ffdb78)] text-black shadow-[0_16px_36px_rgba(240,185,96,0.35)] hover:translate-y-[-1px]'
                            )}
                          >
                            {isGenerating ? (
                              <>
                                <Loader2 className="h-4.5 w-4.5 animate-spin" />
                                正在生成语音
                              </>
                            ) : (
                              <>
                                <Volume2 className="h-4.5 w-4.5" />
                                立即生成
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-1">
                  <div className="min-h-[185px] rounded-[26px] border border-[var(--line-strong)] bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))] p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                          创作状态
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-white">{text.length}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-right">
                        <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-[var(--muted)]">预计时长</div>
                        <div className="mt-1 text-sm font-medium text-white">{estimatedSeconds}s</div>
                      </div>
                    </div>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),#ffdf7a)] transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(12, text.length / 6))}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--soft)]">
                      文本长度和生成时长会随着内容变化动态更新，适合快速口播稿与短音频测试。
                    </p>
                  </div>
                  <div className="min-h-[185px] rounded-[26px] border border-white/10 bg-black/20 p-5">
                    <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                      当前模型
                    </div>
                    <div className="mt-3 text-xl font-semibold text-white">
                      {selectedModel?.label || config.modelId}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--soft)]">
                      {selectedModel?.note || '自定义模型配置'}
                    </p>
                  </div>
                  <div className="min-h-[185px] rounded-[26px] border border-white/10 bg-black/20 p-5">
                    <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                      当前音色
                    </div>
                    <div className="mt-3 text-xl font-semibold text-white">
                      {isCloneMode ? 'Custom Clone' : selectedVoice?.label || '未选择'}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--soft)]">
                      {isCloneMode ? '使用上传的人声音频做克隆参考。' : selectedVoice?.description || '从预设里选择一个声音风格。'}
                    </p>
                  </div>
                  <div className="min-h-[185px] rounded-[26px] border border-white/10 bg-black/20 p-5">
                    <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                      情绪提示
                    </div>
                    <div className="mt-3 text-xl font-semibold text-white">
                      {selectedEmotion ? `${selectedEmotion.emoji} ${selectedEmotion.label}` : '自由发挥'}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--soft)]">
                      {config.instruct?.trim() ? '已附加 instruct 描述，会影响发声风格。' : '未设置时会使用更自然的默认朗读风格。'}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className={cn(cardClass, 'p-5 sm:p-6 xl:p-8')}>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-2)] p-3">
                    <History className="h-5 w-5 text-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                      History
                    </div>
                    <h2 className="text-2xl font-semibold text-white">最近生成记录</h2>
                  </div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-mono uppercase tracking-[0.24em] text-[var(--muted)]">
                  {history.length} items
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <AnimatePresence mode="popLayout">
                  {history.map((item) => {
                    const itemVoice = PRESET_VOICES.find(voice => voice.id === item.voice)?.label || item.voice;
                    const itemEmotion = EMOTION_PRESETS.find(preset => preset.val === item.instruct);

                    return (
                      <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        className="group rounded-[24px] border border-white/10 bg-[rgba(10,14,24,0.9)] p-4 transition hover:border-[var(--line-strong)] hover:bg-[rgba(13,18,32,0.95)] sm:p-5"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                          <button
                            onClick={() => playAudio(item)}
                            className={cn(
                              'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border transition',
                              currentAudio === item.audioUrl && isPlaying
                                ? 'border-[var(--accent)] bg-[var(--accent)] text-black'
                                : 'border-white/10 bg-white/6 text-white hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)]'
                            )}
                          >
                            {currentAudio === item.audioUrl && isPlaying ? (
                              <Square className="h-5 w-5 fill-current" />
                            ) : (
                              <Play className="ml-0.5 h-5 w-5 fill-current" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="text-base font-medium leading-7 text-white">{item.text}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[11px] text-[var(--soft)]">
                                <Clock className="h-3.5 w-3.5" />
                                {format(item.timestamp, 'MM-dd HH:mm')}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[11px] text-[var(--soft)]">
                                <Type className="h-3.5 w-3.5" />
                                {itemVoice} / {item.speed}x
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[11px] text-[var(--soft)]">
                                种子 {item.seed === -1 ? '随机' : item.seed}
                              </span>
                              {itemEmotion && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line-strong)] bg-[var(--accent)]/12 px-3 py-1 text-[11px] text-[var(--accent)]">
                                  {itemEmotion.emoji} {itemEmotion.label}
                                </span>
                              )}
                              {item.isCloned && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-cool)]/50 bg-[var(--accent-cool)]/10 px-3 py-1 text-[11px] text-[var(--accent-cool)]">
                                  克隆音色
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end md:self-auto md:opacity-0 md:transition md:group-hover:opacity-100">
                            <button
                              onClick={() => downloadAudio(item)}
                              className="rounded-xl border border-white/10 bg-white/5 p-3 text-[var(--soft)] transition hover:border-[var(--line-strong)] hover:text-white"
                              title="下载"
                            >
                              <Download className="h-4.5 w-4.5" />
                            </button>
                            <button
                              onClick={() => deleteHistoryItem(item.id)}
                              className="rounded-xl border border-white/10 bg-white/5 p-3 text-[var(--soft)] transition hover:border-red-400/40 hover:text-red-300"
                              title="删除"
                            >
                              <Trash2 className="h-4.5 w-4.5" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {history.length === 0 && (
                  <div className="rounded-[26px] border border-dashed border-white/12 bg-black/15 px-6 py-14 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5">
                      <AudioLines className="h-7 w-7 text-[var(--muted)]" />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold text-white">这里会显示你的音频作品</h3>
                    <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-[var(--soft)]">
                      先在上面输入文本并点击“立即生成”，新结果会自动存到本地记录区，方便回听、下载和对比参数。
                    </p>
                  </div>
                )}
              </div>
            </section>
          </main>

          <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <section className={cn(cardClass, 'p-5 sm:p-6')}>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-2)] p-3">
                  <Settings className="h-5 w-5 text-[var(--accent)]" />
                </div>
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                    Control Deck
                  </div>
                  <h2 className="text-2xl font-semibold text-white">参数控制台</h2>
                </div>
              </div>

              <div className="mt-6 space-y-6">
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                        当前模式
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">{isCloneMode ? 'Voice Clone' : 'Preset Voice'}</div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--soft)]">
                      {config.responseFormat.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--soft)]">
                    {isCloneMode
                      ? '已加载参考音频，当前会自动使用支持 ref_audio 的 Base 模型来锁定说话人。'
                      : '当前直接使用预设音色。这个接口更像“风格模板”，不保证每次都是严格同一个人。'}
                  </p>
                </div>

                <div className="rounded-[24px] border border-[var(--line-strong)] bg-[linear-gradient(180deg,rgba(240,185,96,0.12),rgba(255,255,255,0.03))] p-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl border border-[var(--line-strong)] bg-black/20 p-2.5">
                      <AudioLines className="h-5 w-5 text-[var(--accent)]" />
                    </div>
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">
                        语音克隆
                      </div>
                      <div className="mt-1 text-lg font-semibold text-white">参考音频面板</div>
                    </div>
                  </div>

                  {config.referenceAudio ? (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-[var(--line-strong)] bg-black/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white">{config.referenceAudioName}</div>
                            <p className="mt-1 text-xs leading-5 text-[var(--soft)]">已切换到克隆模式，建议使用 5-10 秒清晰干声。</p>
                          </div>
                          <button
                            onClick={clearReferenceAudio}
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-[var(--soft)] transition hover:border-red-400/40 hover:text-red-300"
                            title="移除参考音频"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <audio controls src={config.referenceAudio} className="mt-3 w-full opacity-80" />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[11px] font-mono uppercase tracking-[0.24em] text-[var(--muted)]">
                          参考音频文本{' '}
                          <span className="text-[var(--accent)]">
                            {referenceTextRequired ? '当前接口必填' : '建议填写'}
                          </span>
                        </label>
                        <textarea
                          value={config.referenceText || ''}
                          onChange={(e) => setConfig(prev => ({ ...prev, referenceText: e.target.value }))}
                          placeholder={
                            referenceTextRequired
                              ? '当前接口要求填写参考音频里实际说的内容，否则服务端会直接报错。'
                              : '建议准确填写参考音频里说的内容；不填也可尝试，但稳定性和相似度通常会更差。'
                          }
                          className="h-24 w-full resize-none rounded-2xl border border-white/10 bg-[var(--panel)] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-[var(--line-strong)] placeholder:text-[var(--muted)]"
                        />
                        <p className="text-xs leading-6 text-[var(--soft)]">
                          {referenceTextRequired
                            ? '你现在使用的兼容接口会强制要求 ref_text，所以这里必须填写；而且写得越准确，克隆越稳定。'
                            : '官方文档里克隆音色的文本字段是可选的；但在实际兼容接口中，补上原文通常更稳定，也更容易保住同一个人。'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="group flex w-full flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-white/15 bg-black/15 px-4 py-6 text-center transition hover:border-[var(--line-strong)] hover:bg-black/20"
                      >
                        <div className="rounded-2xl border border-white/10 bg-white/6 p-3 transition group-hover:border-[var(--line-strong)]">
                          <Upload className="h-5 w-5 text-[var(--accent)]" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">上传参考音频</div>
                          <p className="mt-1 text-xs leading-5 text-[var(--soft)]">支持 WAV / MP3，文件不超过 5MB</p>
                        </div>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">预设音色</label>
                    <span className="text-xs text-[var(--soft)]">{config.referenceAudio ? '克隆模式已锁定' : '可切换'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESET_VOICES.map((voice) => (
                      <button
                        key={voice.id}
                        disabled={!!config.referenceAudio}
                        onClick={() => setConfig(prev => ({
                          ...prev,
                          voice: voice.id,
                          modelId:
                            availableModelIds.find(id => id === DEFAULT_MODEL_ID) ||
                            availableModelIds.find(id => id.includes('CustomVoice')) ||
                            DEFAULT_MODEL_ID
                        }))}
                        className={cn(
                          'rounded-2xl border px-3 py-3 text-left transition',
                          config.voice === voice.id && !config.referenceAudio
                            ? 'border-[var(--line-strong)] bg-[var(--panel-2)] text-white'
                            : 'border-white/10 bg-white/5 text-[var(--soft)] hover:border-white/20 hover:text-white',
                          config.referenceAudio && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <div className="text-sm font-medium">{voice.label}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">{voice.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">语气与情绪</label>
                    {config.instruct && (
                      <button
                        onClick={() => setConfig(prev => ({ ...prev, instruct: '' }))}
                        className="text-xs text-[var(--soft)] transition hover:text-white"
                      >
                        清除
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {EMOTION_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => setConfig(prev => ({
                          ...prev,
                          instruct: preset.val,
                          modelId: prev.modelId.includes('CustomVoice')
                            ? prev.modelId
                            : (availableModelIds.find(id => id.includes('CustomVoice')) || DEFAULT_MODEL_ID)
                        }))}
                        className={cn(
                          'rounded-2xl border px-3 py-3 text-left transition',
                          config.instruct === preset.val
                            ? 'border-[var(--line-strong)] bg-[var(--panel-2)] text-white'
                            : 'border-white/10 bg-white/5 text-[var(--soft)] hover:border-white/20 hover:text-white'
                        )}
                      >
                        <div className="text-sm font-medium">
                          {preset.emoji} {preset.label}
                        </div>
                        <div className="mt-1 text-[11px] leading-5 text-[var(--muted)]">一键填充 instruct 语气描述</div>
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={config.instruct || ''}
                    onChange={(e) => setConfig(prev => ({
                      ...prev,
                      instruct: e.target.value,
                      modelId: e.target.value.trim() && !prev.modelId.includes('CustomVoice')
                        ? (availableModelIds.find(id => id.includes('CustomVoice')) || DEFAULT_MODEL_ID)
                        : prev.modelId
                    }))}
                    placeholder="或者直接输入英文指令，例如 Speak slowly and warmly..."
                    className="w-full rounded-2xl border border-white/10 bg-[var(--panel)] px-4 py-3 text-sm text-white outline-none transition focus:border-[var(--line-strong)] placeholder:text-[var(--muted)]"
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">播放语速</label>
                      <span className="text-sm font-semibold text-white">{config.speed}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.25"
                      max="4"
                      step="0.25"
                      value={config.speed}
                      onChange={(e) => setConfig(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                      className="range-input"
                    />
                    <div className="flex justify-between text-xs text-[var(--muted)]">
                      <span>0.25x</span>
                      <span>4.0x</span>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">回放音量</label>
                      <span className="text-sm font-semibold text-white">{config.gain.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.25"
                      max="1"
                      step="0.05"
                      value={config.gain}
                      onChange={(e) => setConfig(prev => ({ ...prev, gain: parseFloat(e.target.value) }))}
                      className="range-input"
                    />
                    <div className="flex justify-between text-xs text-[var(--muted)]">
                      <span>0.25x</span>
                      <span>1.0x</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">随机种子</label>
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, seed: Math.floor(Math.random() * 2147483647) }))}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[var(--soft)] transition hover:border-[var(--line-strong)] hover:text-white"
                    >
                      随机
                    </button>
                  </div>
                  <input
                    type="number"
                    value={config.seed === -1 ? '' : config.seed}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      setConfig(prev => ({ ...prev, seed: Number.isNaN(value) ? -1 : value }));
                    }}
                    placeholder="-1 代表完全随机"
                    className="w-full rounded-2xl border border-white/10 bg-[var(--panel)] px-4 py-3 text-sm text-white outline-none transition focus:border-[var(--line-strong)] placeholder:text-[var(--muted)]"
                  />
                  <p className="text-xs leading-6 text-[var(--soft)]">
                    {seedIsExperimental
                      ? '当前接口实测并不会严格按 seed 复现结果，所以它只能算实验参数，不能保证每次还是同一个人。'
                      : '固定种子适合复现同一发声结果，留空或填 `-1` 则每次随机。'}
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-mono uppercase tracking-[0.28em] text-[var(--muted)]">输出格式</label>
                  <div className="grid grid-cols-4 gap-2">
                    {RESPONSE_FORMATS.map((formatItem) => (
                      <button
                        key={formatItem}
                        onClick={() => setConfig(prev => ({ ...prev, responseFormat: formatItem }))}
                        className={cn(
                          'rounded-2xl border px-2 py-3 text-center text-xs font-semibold uppercase transition',
                          config.responseFormat === formatItem
                            ? 'border-[var(--line-strong)] bg-[var(--panel-2)] text-white'
                            : 'border-white/10 bg-white/5 text-[var(--soft)] hover:border-white/20 hover:text-white'
                        )}
                      >
                        {formatItem}
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </section>
          </aside>
        </div>
      </div>

      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} className="hidden" />
    </div>
  );
}
