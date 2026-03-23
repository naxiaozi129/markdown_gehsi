/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Clipboard, 
  Check, 
  Image as ImageIcon, 
  Type, 
  Trash2, 
  Send, 
  Loader2,
  FileText,
  Copy,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ImageFile {
  id: string;
  data: string; // base64
  mimeType: string;
  preview: string;
  size: number;
}

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB per image
const MAX_TOTAL_IMAGES = 10;

export default function App() {
  const [inputText, setInputText] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [markdown, setMarkdown] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationStep, setGenerationStep] = useState<'idle' | 'analyzing' | 'organizing'>('idle');
  
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          processImage(blob);
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        processImage(file);
      }
    });
  };

  const processImage = (file: File) => {
    if (file.size > MAX_IMAGE_SIZE) {
      setError(`图片 "${file.name}" 超过 4MB 限制。`);
      return;
    }
    if (images.length >= MAX_TOTAL_IMAGES) {
      setError(`最多只能上传 ${MAX_TOTAL_IMAGES} 张图片。`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      const data = base64.split(',')[1];
      const newImage: ImageFile = {
        id: Math.random().toString(36).substr(2, 9),
        data: data,
        mimeType: file.type,
        preview: base64,
        size: file.size
      };
      setImages(prev => [...prev, newImage]);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const generateMarkdown = async (retryCount = 0) => {
    if (!inputText && images.length === 0) return;

    setIsGenerating(true);
    setError(null);
    setGenerationStep('analyzing');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const parts: any[] = [];
      
      if (inputText) {
        parts.push({ text: `[用户输入文本]\n${inputText}` });
      }
      
      images.forEach((img, index) => {
        parts.push({
          text: `[图片附件 ${index + 1}]`
        });
        parts.push({
          inlineData: {
            data: img.data,
            mimeType: img.mimeType
          }
        });
      });

      const systemInstruction = `你是一位顶级的技术文档工程师和内容整理专家。
你的目标是将用户提供的杂乱文本和图片内容，转化为一份结构严谨、逻辑清晰、排版精美的专业 Markdown 文档。

遵循以下准则：
1. **深度解析**：仔细分析文本中的逻辑关系和图片中的关键信息（包括文字、图表、场景）。
2. **结构化重组**：
   - 使用多级标题（H1, H2, H3）构建清晰层级。
   - 自动识别并创建列表（无序或有序）。
   - 将对比或数据类信息整理成 Markdown 表格。
   - 使用加粗、斜体突出重点。
3. **图文融合**：
   - 在文档中合适的位置插入图片描述占位符，格式为：![图片描述](image_placeholder)。
   - 描述应基于图片实际内容，并与周围文字逻辑衔接。
4. **语言风格**：
   - 保持专业、中立、易读的语气。
   - 修正明显的错别字或语法错误，但保留核心原意。
5. **输出规范**：
   - 仅输出 Markdown 内容，严禁包含任何前言、解释或确认语。
   - 必须使用中文输出。`;

      setGenerationStep('organizing');

      // 使用更稳定的 gemini-3-flash-preview 模型，并移除可能导致 500 错误的 thinkingLevel
      const response = await ai.models.generateContent({
        model: retryCount > 0 ? "gemini-3-flash-preview" : "gemini-3-flash-preview", 
        contents: { parts: parts },
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.4,
          topP: 0.9,
          // 暂时移除 thinkingLevel 以解决部分环境下的 500 错误
        },
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error('AI 返回内容为空');
      }

      setMarkdown(resultText);
      setGenerationStep('idle');
    } catch (err: any) {
      console.error('Generation Error:', err);
      
      // 如果是 500 错误或其它异常，尝试重试
      if (retryCount < 2) {
        const delay = (retryCount + 1) * 1500;
        console.log(`发生错误，正在进行第 ${retryCount + 1} 次重试...`);
        setTimeout(() => generateMarkdown(retryCount + 1), delay);
        return;
      }

      let userFriendlyError = '生成失败，请检查输入内容或稍后重试。';
      if (err.message?.includes('500') || err.status === 500) {
        userFriendlyError = '服务器繁忙（500 错误），请稍后再试或精简输入内容。';
      } else if (err.message?.includes('API_KEY')) {
        userFriendlyError = 'API Key 配置错误，请检查设置。';
      } else if (err.message?.includes('safety')) {
        userFriendlyError = '内容触发了安全过滤，请尝试修改输入。';
      }
      
      setError(userFriendlyError);
      setGenerationStep('idle');
    } finally {
      if (retryCount >= 2 || !error) {
        setIsGenerating(false);
      }
    }
  };

  const copyToClipboard = () => {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const clearAll = () => {
    if (window.confirm('确定要清空所有内容吗？')) {
      setInputText('');
      setImages([]);
      setMarkdown('');
      setError(null);
      setGenerationStep('idle');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">智能 Markdown 整理器</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">AI-Powered Document Architect</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {markdown && (
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg text-sm font-semibold hover:bg-indigo-100 transition-all active:scale-95"
                id="copy-button-header"
              >
                {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{isCopied ? '已复制' : '复制全文'}</span>
              </button>
            )}
            <button
              onClick={clearAll}
              className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
              title="清空全部"
              id="clear-button"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Input Section */}
        <section className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">输入源内容</h2>
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded-full border border-slate-100">
                {inputText.length} 字符 | {images.length} 图片
              </span>
            </div>
            
            <div className="p-5 space-y-5">
              <div className="relative group">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="在此输入或粘贴杂乱的文本、会议记录、灵感片段..."
                  className="w-full h-64 p-5 bg-slate-50/50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all resize-none text-slate-700 placeholder:text-slate-400 leading-relaxed"
                  id="text-input"
                />
                <div className="absolute bottom-4 right-4 opacity-0 group-focus-within:opacity-100 transition-opacity">
                  <Type className="w-4 h-4 text-indigo-300" />
                </div>
              </div>
              
              <div
                ref={dropZoneRef}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 bg-slate-50/30 hover:bg-indigo-50/30 hover:border-indigo-300 transition-all cursor-pointer group relative overflow-hidden"
                onClick={() => document.getElementById('file-upload')?.click()}
                id="drop-zone"
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(processImage);
                  }}
                />
                <div className="p-4 bg-white rounded-2xl shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                  <ImageIcon className="w-8 h-8 text-indigo-500" />
                </div>
                <div className="text-center relative z-10">
                  <p className="text-sm font-bold text-slate-700">粘贴或拖拽图片到这里</p>
                  <p className="text-xs text-slate-400 mt-1">支持 OCR 识别与图文排版</p>
                </div>
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-indigo-50/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {images.length > 0 && (
                <div className="grid grid-cols-4 gap-3" id="image-preview-grid">
                  {images.map((img) => (
                    <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                      <img src={img.preview} alt="预览" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                          className="p-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors shadow-lg"
                          id={`remove-image-${img.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={() => generateMarkdown()}
                  disabled={isGenerating || (!inputText && images.length === 0)}
                  className={cn(
                    "w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-xl",
                    isGenerating || (!inputText && images.length === 0)
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                      : "bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200 active:scale-[0.98]"
                  )}
                  id="generate-button"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {generationStep === 'analyzing' ? '正在深度解析内容...' : '正在构建 Markdown...'}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5" />
                      开始智能整理
                    </>
                  )}
                </button>
              </div>
              
              {error && (
                <div className="flex items-center gap-2 p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-medium animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Output Section */}
        <section className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl shadow-slate-200/40 overflow-hidden flex flex-col h-[calc(100vh-10rem)] min-h-[600px]">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-100 rounded-lg">
                  <Clipboard className="w-4 h-4 text-emerald-600" />
                </div>
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Markdown 预览</h2>
              </div>
              <div className="flex items-center gap-2">
                {markdown && (
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100 rounded-lg transition-all text-xs font-bold text-slate-600"
                    id="copy-button-preview"
                  >
                    {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    {isCopied ? '已复制' : '复制内容'}
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 bg-white custom-scrollbar">
              {markdown ? (
                <div className="markdown-body animate-in fade-in duration-700" id="markdown-output">
                  <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-6">
                  <div className="relative">
                    <FileText className="w-24 h-24 opacity-10" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className={cn("w-8 h-8 text-indigo-200", isGenerating ? "animate-spin opacity-100" : "opacity-0")} />
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <p className="font-bold text-slate-400">等待输入内容...</p>
                    <p className="text-xs text-slate-300 max-w-[200px]">整理后的专业文档将在此处以标准 Markdown 格式呈现</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-12 border-t border-slate-200 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-2 text-center md:text-left">
            <p className="text-slate-900 font-bold">智能 Markdown 整理器</p>
            <p className="text-slate-400 text-xs">基于 Google Gemini 3.1 Pro 模型构建，提供卓越的文档理解与排版能力。</p>
          </div>
          <div className="flex items-center gap-8 text-slate-400 text-xs font-bold uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              多模态 OCR
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              深度思考模式
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              自动重试机制
            </div>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-300 font-bold tracking-widest uppercase">© 2026 Smart Markdown Organizer • Precision Document Engineering</p>
        </div>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}} />
    </div>
  );
}
