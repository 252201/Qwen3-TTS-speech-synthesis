/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Download,
  History,
  Settings,
  Volume2,
  Trash2,
  Loader2,
  Mic2,
  ChevronRight,
  ChevronDown,
  Clock,
  Type,
  Upload,
  X,
  AudioLines
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { TTSHistoryItem, TTSConfig } from './types';
import { format } from 'date-fns';
import { saveAudio, getAudio, deleteAudio } from './lib/db';
import { convertToWav } from './lib/audioUtils';

const DEFAULT_CONFIG: TTSConfig = {
  apiKey: import.meta.env.VITE_TTS_API_KEY || 'omlx-mpi54dic99snaxxp',
  apiHost: 'https://api.252202.xyz/v1/audio/speech',
  modelId: import.meta.env.VITE_TTS_MODEL_ID || 'Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit',
  voice: 'vivian',
  speed: 1.0,
  seed: 42,
  responseFormat: 'mp3'
};

const PRESET_VOICES = [
  { id: 'vivian', label: 'Vivian (普通女声)' },
  { id: 'serena', label: 'Serena (活泼女声)' },
  { id: 'uncle_fu', label: 'Uncle_Fu (醇厚大叔)' },
  { id: 'dylan', label: 'Dylan (北京男声)' },
  { id: 'eric', label: 'Eric (成都男声)' },
  { id: 'ryan', label: 'Ryan (英文男声)' },
  { id: 'aiden', label: 'Aiden (美音男声)' },
  { id: 'ono_anna', label: 'Anna (日文女声)' },
  { id: 'sohee', label: 'Sohee (韩文女声)' }
];

const EMOTION_PRESETS = [
  { val: 'Speak with excitement and high energy.', label: '😊 开心兴奋' },
  { val: 'Speak in a sad, slow, and low-pitched voice.', label: '😔 悲伤低沉' },
  { val: 'Speak with a strict, serious, and slightly angry tone.', label: '😠 严肃生气' },
  { val: 'Speak softly, gently, and calmly like a whisper.', label: '🤫 温柔轻语' },
  { val: 'Speak clearly and professionally like a news anchor.', label: '🎙️ 专业播音' },
  { val: 'Speak in a panicked and rushed tone.', label: '😰 惊慌急促' }
];

export default function App() {
  const [text, setText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<TTSHistoryItem[]>([]);
  const [config, setConfig] = useState<TTSConfig>(DEFAULT_CONFIG);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isApiConfigOpen, setIsApiConfigOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history and config from localStorage
  useEffect(() => {
    const loadData = async () => {
      const savedHistory = localStorage.getItem('tts_history');
      if (savedHistory) {
        try {
          const parsed: TTSHistoryItem[] = JSON.parse(savedHistory);
          const hydrated = await Promise.all(parsed.map(async (item) => {
            const blob = await getAudio(item.id);
            if (blob) {
              return { ...item, audioUrl: URL.createObjectURL(blob) };
            }
            return null; // Ignore items without audio data
          }));
          setHistory(hydrated.filter(item => item !== null) as TTSHistoryItem[]);
        } catch (e) {
          console.error('Failed to parse history', e);
        }
      }

      const savedConfig = localStorage.getItem('tts_config');
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig);
          setConfig(prev => ({ ...prev, ...parsed }));
        } catch (e) {
          console.error('Failed to parse config', e);
        }
      }
    };

    loadData();
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('tts_history', JSON.stringify(history));
  }, [history]);

  // Save config to localStorage (excluding reference audio large base64 buffers to save space)
  useEffect(() => {
    const { referenceAudio, referenceAudioRaw, referenceText, ...saveableConfig } = config;
    localStorage.setItem('tts_config', JSON.stringify(saveableConfig));
  }, [config]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('音频文件不能超过 5MB');
      return;
    }

    try {
      // Convert any audio format to WAV (omlx voice cloning requires WAV)
      const { wavBlob, rawBase64 } = await convertToWav(file);
      const previewUrl = URL.createObjectURL(wavBlob);
      setConfig(prev => ({
        ...prev,
        referenceAudio: previewUrl, // For local preview
        referenceAudioRaw: rawBase64, // Pure base64 WAV for ref_audio field
        referenceAudioName: file.name,
        voice: 'custom' // Switch to custom voice mode
      }));
    } catch (err) {
      console.error('Audio conversion failed:', err);
      alert('音频文件解码失败，请尝试使用 WAV 格式的音频文件。');
    }
  };

  const clearReferenceAudio = () => {
    setConfig(prev => ({
      ...prev,
      referenceAudio: undefined,
      referenceAudioRaw: undefined,
      referenceAudioName: undefined,
      referenceText: undefined,
      voice: 'alloy'
    }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!text.trim() || isGenerating) return;

    // Validate ref_text is provided when voice cloning is active
    if (config.voice === 'custom' && config.referenceAudioRaw && !config.referenceText?.trim()) {
      alert('语音克隆需要填写「参考音频文本」，请在右侧输入参考音频中说的话。');
      return;
    }

    setIsGenerating(true);
    try {
      // Prepare request body
      const body: any = {
        model: config.modelId,
        input: text,
        voice: config.voice === 'custom' ? 'alloy' : config.voice,
        speed: config.speed,
        seed: config.seed,
        instruct: config.instruct,
        response_format: config.responseFormat
      };

      // Voice cloning: use ref_audio + ref_text (omlx v0.3.5 API)
      if (config.voice === 'custom' && config.referenceAudioRaw) {
        body.ref_audio = config.referenceAudioRaw;
        body.ref_text = config.referenceText || '';
      }

      const response = await fetch(config.apiHost, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
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
        text: text,
        timestamp: Date.now(),
        audioUrl: audioUrl,
        model: config.modelId,
        voice: config.voice === 'custom' ? `克隆: ${config.referenceAudioName}` : config.voice,
        speed: config.speed,
        seed: config.seed,
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
    const url = item.audioUrl;
    if (audioRef.current) {
      if (currentAudio === url && isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.src = url;
        audioRef.current.playbackRate = item.speed || 1.0;
        audioRef.current.play();
        setCurrentAudio(url);
        setIsPlaying(true);
      }
    }
  };

  const downloadAudio = (item: TTSHistoryItem) => {
    const a = document.createElement('a');
    a.href = item.audioUrl;
    a.download = `qwen3-tts-${item.id.slice(0, 8)}.mp3`;
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
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.audioUrl);
      return prev.filter(i => i.id !== id);
    });
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] font-sans selection:bg-[#F27D26] selection:text-white">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#F27D26]/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#F27D26]/5 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-12">

        {/* Main Content Area */}
        <main className="space-y-8">
          <header className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#F27D26] rounded-lg">
                <Mic2 className="w-6 h-6 text-black" />
              </div>
              <h1 className="text-4xl font-bold tracking-tighter uppercase italic font-serif">
                Qwen3 语音合成工作室
              </h1>
            </div>
            <p className="text-[#8E9299] font-mono text-xs uppercase tracking-widest">
              模型: {config.modelId} • 12Hz • 1.7B 参数
            </p>
          </header>

          <section className="space-y-4">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-[#F27D26] to-[#F27D26]/20 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-500" />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="请输入要合成的文本..."
                className="relative w-full h-64 bg-[#151619] border border-[#2A2B2F] rounded-2xl p-6 text-xl leading-relaxed focus:outline-none focus:border-[#F27D26] transition-colors resize-none placeholder:text-[#3A3B3F]"
              />
              <div className="absolute bottom-4 right-4 flex items-center gap-4">
                <span className="text-xs font-mono text-[#5A5B5F]">
                  {text.length} 个字符
                </span>
                <button
                  onClick={handleGenerate}
                  disabled={!text.trim() || isGenerating}
                  className={cn(
                    "flex items-center gap-2 px-6 py-3 rounded-full font-bold uppercase tracking-wider transition-all",
                    isGenerating
                      ? "bg-[#2A2B2F] text-[#5A5B5F] cursor-not-allowed"
                      : "bg-[#F27D26] text-black hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(242,125,38,0.3)]"
                  )}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      正在合成...
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-5 h-5" />
                      立即生成语音
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* History Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between border-b border-[#2A2B2F] pb-4">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-[#F27D26]" />
                <h2 className="text-xl font-bold uppercase italic font-serif">最近生成记录</h2>
              </div>
              <span className="text-xs font-mono text-[#5A5B5F] uppercase tracking-widest">
                {history.length} 条记录
              </span>
            </div>

            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {history.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group bg-[#151619] border border-[#2A2B2F] rounded-xl p-4 flex items-center gap-4 hover:border-[#F27D26]/50 transition-all"
                  >
                    <button
                      onClick={() => playAudio(item)}
                      className={cn(
                        "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                        currentAudio === item.audioUrl && isPlaying
                          ? "bg-[#F27D26] text-black"
                          : "bg-[#2A2B2F] text-[#E0E0E0] hover:bg-[#3A3B3F]"
                      )}
                    >
                      {currentAudio === item.audioUrl && isPlaying ? (
                        <Square className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-1" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-1 font-medium text-[#E0E0E0]">
                        {item.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-mono text-[#5A5B5F] uppercase flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3" />
                          {format(item.timestamp, 'HH:mm:ss')}
                        </span>
                        <span className="text-[10px] font-mono text-[#5A5B5F] uppercase flex items-center gap-1 shrink-0">
                          <Type className="w-3 h-3" />
                          音色: {PRESET_VOICES.find(v => v.id === item.voice)?.label || item.voice.toUpperCase()}
                          &nbsp;• 语速: {item.speed}x
                        </span>
                        <span className="text-[10px] font-mono text-[#5A5B5F] uppercase flex items-center shrink-0">
                          • 种子: <span className="text-[#8E9299] ml-1 select-all">{item.seed === -1 ? '随机' : item.seed}</span>
                        </span>
                        {item.instruct && (
                          <span className="px-1.5 py-0.5 rounded bg-[#F27D26]/10 border border-[#F27D26]/30 text-[#F27D26] text-[9px] font-bold shrink-0">
                            {EMOTION_PRESETS.find(p => p.val === item.instruct)?.label || '✨ 自定义情绪'}
                          </span>
                        )}
                        {item.isCloned && (
                          <span className="px-1.5 py-0.5 rounded bg-[#F27D26]/20 text-[#F27D26] text-[8px] font-bold uppercase shrink-0">
                            语音克隆
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => downloadAudio(item)}
                        className="p-2 text-[#8E9299] hover:text-[#F27D26] transition-colors"
                        title="下载"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => deleteHistoryItem(item.id)}
                        className="p-2 text-[#8E9299] hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {history.length === 0 && (
                <div className="py-12 text-center border-2 border-dashed border-[#2A2B2F] rounded-2xl">
                  <p className="text-[#5A5B5F] font-mono text-sm uppercase tracking-widest">
                    暂无历史记录。在上方输入文本开始生成。
                  </p>
                </div>
              )}
            </div>
          </section>
        </main>

        {/* Sidebar Settings */}
        <aside className="space-y-8">
          <div className="bg-[#151619] border border-[#2A2B2F] rounded-2xl p-6 sticky top-12">
            <div className="flex items-center gap-2 mb-8">
              <Settings className="w-5 h-5 text-[#F27D26]" />
              <h2 className="text-xl font-bold uppercase italic font-serif">参数设置</h2>
            </div>

            <div className="space-y-8">
              {/* Voice Cloning Section */}
              <div className="space-y-3 p-4 bg-[#0A0A0A] rounded-xl border border-[#2A2B2F] relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                  <AudioLines className="w-12 h-12 text-[#F27D26]" />
                </div>
                <label className="text-[10px] font-mono text-[#F27D26] uppercase tracking-[0.2em] font-bold">
                  语音克隆 (Voice Cloning)
                </label>

                {config.referenceAudio ? (
                  <div className="space-y-3 relative z-10">
                    <div className="flex items-center justify-between bg-[#151619] p-2 rounded-lg border border-[#F27D26]/30">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 bg-[#F27D26] rounded-full animate-pulse" />
                        <span className="text-[10px] font-mono text-[#E0E0E0] truncate">
                          {config.referenceAudioName}
                        </span>
                      </div>
                      <button
                        onClick={clearReferenceAudio}
                        className="p-1 hover:bg-[#2A2B2F] rounded-md text-[#8E9299] hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* ref_text input — required by omlx v0.3.5 */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono text-[#8E9299] uppercase tracking-wider">
                        参考音频文本 (ref_text) <span className="text-[#F27D26]">*必填</span>
                      </label>
                      <textarea
                        value={config.referenceText || ''}
                        onChange={(e) => setConfig(prev => ({ ...prev, referenceText: e.target.value }))}
                        placeholder="请输入参考音频中说的话（需准确匹配，否则克隆效果会变差）"
                        className="w-full h-16 bg-[#151619] border border-[#2A2B2F] rounded-lg px-2 py-1.5 text-[10px] font-mono focus:outline-none focus:border-[#F27D26] transition-colors text-[#E0E0E0] placeholder:text-[#3A3B3F] resize-none"
                      />
                    </div>

                    <p className="text-[9px] text-[#5A5B5F] leading-tight">
                      已启用克隆模式。请务必准确填写参考音频中的文本内容。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 relative z-10">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-3 border-2 border-dashed border-[#2A2B2F] rounded-lg flex flex-col items-center gap-2 hover:border-[#F27D26]/50 hover:bg-[#151619] transition-all group"
                    >
                      <Upload className="w-5 h-5 text-[#5A5B5F] group-hover:text-[#F27D26] transition-colors" />
                      <span className="text-[10px] font-mono text-[#5A5B5F] uppercase">上传参考音频</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <p className="text-[9px] text-[#3A3B3F] text-center">
                      支持 WAV/MP3，建议 5-10 秒清晰人声
                    </p>
                  </div>
                )}
              </div>

              {/* Voice Selection */}
              <div className="space-y-3">
                <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-[0.2em]">
                  预设音色 (Qwen3-TTS CustomVoice)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_VOICES.map((v) => (
                    <button
                      key={v.id}
                      disabled={!!config.referenceAudio}
                      onClick={() => setConfig(prev => ({ ...prev, voice: v.id }))}
                      className={cn(
                        "px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border",
                        config.voice === v.id && !config.referenceAudio
                          ? "bg-[#F27D26] text-black border-[#F27D26]"
                          : "bg-[#0A0A0A] text-[#8E9299] border-[#2A2B2F] hover:border-[#F27D26]/50",
                        config.referenceAudio && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Emotion / Tone Instruction */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-[0.2em]">
                    语气与情绪提示 (Instruct)
                  </label>
                  {config.instruct && (
                    <button
                      onClick={() => setConfig(prev => ({ ...prev, instruct: '' }))}
                      className="text-[9px] text-[#8E9299] hover:text-red-500 transition-colors uppercase font-mono"
                    >
                      清除提示词
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {EMOTION_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setConfig(prev => ({ ...prev, instruct: preset.val }))}
                      className={cn(
                        "px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all border",
                        config.instruct === preset.val
                          ? "bg-[#F27D26]/20 text-[#F27D26] border-[#F27D26]/50"
                          : "bg-[#0A0A0A] text-[#8E9299] border-[#2A2B2F] hover:border-[#F27D26]/30 hover:text-[#E0E0E0]"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={config.instruct || ''}
                    onChange={(e) => setConfig(prev => ({ ...prev, instruct: e.target.value }))}
                    placeholder="或者用自然语言自定义，例如 'Speak slowly...'"
                    className="w-full bg-[#151619] border border-[#2A2B2F] rounded-lg px-3 py-2 text-[10px] font-mono focus:outline-none focus:border-[#F27D26] transition-colors text-[#E0E0E0] placeholder:text-[#3A3B3F]"
                  />
                </div>
                <p className="text-[9px] font-mono text-[#3A3B3F] leading-tight">
                  仅支持 CustomVoice 模型。使用英文自然语言描述语气即可精准改变预设音色的发音情绪。
                </p>
              </div>

              {/* Speed Slider */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-[0.2em]">
                    播放语速 (生成不变仅限本地)
                  </label>
                  <span className="text-xs font-mono text-[#F27D26]">{config.speed}x</span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="4.0"
                  step="0.25"
                  value={config.speed}
                  onChange={(e) => setConfig(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-[#2A2B2F] rounded-lg appearance-none cursor-pointer accent-[#F27D26]"
                />
                <div className="flex justify-between text-[10px] font-mono text-[#3A3B3F]">
                  <span>0.25x</span>
                  <span>4.0x</span>
                </div>
              </div>

              {/* Seed Configuration */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-[0.2em]">
                    重现随机种子 (Seed)
                  </label>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, seed: Math.floor(Math.random() * 2147483647) }))}
                    className="text-[9px] text-[#8E9299] hover:text-[#F27D26] border border-[#2A2B2F] rounded px-1.5 py-0.5 transition-colors uppercase font-mono"
                    title="随机生成一个新的种子"
                  >
                    🎲 随机
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={config.seed === -1 ? '' : config.seed}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setConfig(prev => ({ ...prev, seed: isNaN(val) ? -1 : val }));
                    }}
                    placeholder="-1 (代表完全随机)"
                    className="w-full bg-[#0A0A0A] border border-[#2A2B2F] rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-[#F27D26] transition-colors text-[#E0E0E0] placeholder:text-[#3A3B3F]"
                  />
                </div>
                <p className="text-[9px] font-mono text-[#3A3B3F] leading-relaxed">
                  影响发声器底层采样一致性。填入固定数字（如 42）可让音色完全稳定，留空或 -1 则每次随机生成。
                </p>
              </div>

              {/* Format Selection */}
              <div className="space-y-3">
                <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-[0.2em]">
                  输出格式
                </label>
                <div className="flex gap-2">
                  {['mp3', 'opus', 'aac', 'flac'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setConfig(prev => ({ ...prev, responseFormat: f }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border",
                        config.responseFormat === f
                          ? "bg-[#F27D26] text-black border-[#F27D26]"
                          : "bg-[#0A0A0A] text-[#8E9299] border-[#2A2B2F] hover:border-[#F27D26]/50"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* API Info Settings */}
              <div className="pt-8 border-t border-[#2A2B2F] space-y-4">
                <button
                  onClick={() => setIsApiConfigOpen(!isApiConfigOpen)}
                  className="w-full flex items-center justify-between mb-2 group"
                >
                  <span className="text-[10px] font-mono text-[#F27D26] uppercase tracking-[0.2em] font-bold group-hover:text-white transition-colors">
                    API 配置
                  </span>
                  {isApiConfigOpen ? (
                    <ChevronDown className="w-4 h-4 text-[#5A5B5F] group-hover:text-white transition-colors" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-[#5A5B5F] group-hover:text-white transition-colors" />
                  )}
                </button>

                {isApiConfigOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 overflow-hidden"
                  >
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-widest block">接口地址 (API Host)</label>
                      <input
                        type="text"
                        value={config.apiHost}
                        onChange={(e) => setConfig(prev => ({ ...prev, apiHost: e.target.value }))}
                        placeholder="https://api.example.com/v1/..."
                        className="w-full bg-[#0A0A0A] border border-[#2A2B2F] rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-[#F27D26] transition-colors text-[#E0E0E0] placeholder:text-[#3A3B3F]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-widest block">模型 ID (Model ID)</label>
                      <input
                        type="text"
                        value={config.modelId}
                        onChange={(e) => setConfig(prev => ({ ...prev, modelId: e.target.value }))}
                        placeholder="Qwen3-TTS..."
                        className="w-full bg-[#0A0A0A] border border-[#2A2B2F] rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-[#F27D26] transition-colors text-[#E0E0E0] placeholder:text-[#3A3B3F]"
                      />
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {[
                          { id: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit', label: '1.7B-CustomVoice (预设推荐)' },
                          { id: 'Qwen3-TTS-12Hz-1.7B-Base-8bit', label: '1.7B-Base (克隆推荐)' },
                          { id: 'Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit', label: '0.6B-CustomVoice' },
                          { id: 'Qwen3-TTS-12Hz-0.6B-Base', label: '0.6B-Base' }
                        ].map(preset => (
                          <button
                            key={preset.id}
                            onClick={() => setConfig(prev => ({ ...prev, modelId: preset.id }))}
                            className={cn(
                              "px-2 py-1 rounded-md text-[9px] font-mono transition-all border",
                              config.modelId === preset.id
                                ? "bg-[#F27D26]/20 text-[#F27D26] border-[#F27D26]/50"
                                : "bg-[#0A0A0A] text-[#5A5B5F] border-[#2A2B2F] hover:border-[#F27D26]/30 hover:text-[#8E9299]"
                            )}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-[#5A5B5F] uppercase tracking-widest block">API 密钥 (API Key)</label>
                      <input
                        type="password"
                        value={config.apiKey}
                        onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="sk-..."
                        className="w-full bg-[#0A0A0A] border border-[#2A2B2F] rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-[#F27D26] transition-colors text-[#E0E0E0] placeholder:text-[#3A3B3F]"
                      />
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />
    </div>
  );
}
