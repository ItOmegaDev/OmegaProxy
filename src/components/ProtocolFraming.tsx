import React, { useState } from 'react';
import { 
  Binary, 
  Cpu, 
  Send, 
  Activity, 
  Copy, 
  Check, 
  Zap, 
  ArrowRight, 
  Layers, 
  Terminal,
  ShieldAlert,
  Play,
  RefreshCw
} from 'lucide-react';
import { BinaryFrame, BinaryFrameType } from '../types';

interface ProtocolFramingProps {
  language: 'ua' | 'en';
}

const FRAME_TYPES_INFO = [
  {
    code: '0x01',
    name: 'SYN / Open',
    type: 'SYN' as BinaryFrameType,
    descUa: 'Ініціалізація нового віртуального потоку. Передає цільовий хост та початкові заголовки.',
    descEn: 'Initializes a new virtual stream. Carries target subdomain and initial HTTP connection headers.',
    color: 'emerald',
  },
  {
    code: '0x02',
    name: 'DATA',
    type: 'DATA' as BinaryFrameType,
    descUa: 'Передача корисного навантаження (HTTP тіло, чанки файлів, WebSocket кадри).',
    descEn: 'Data payload transfer (HTTP body chunks, file uploads, WebSocket frames).',
    color: 'sky',
  },
  {
    code: '0x03',
    name: 'FIN / Close',
    type: 'FIN' as BinaryFrameType,
    descUa: 'Завершення та закриття віртуального потоку (Half-close / Full-close socket).',
    descEn: 'Termination and closure of virtual stream (Half-close / Full-close stream).',
    color: 'rose',
  },
  {
    code: '0x04',
    name: 'PING / Heartbeat',
    type: 'PING' as BinaryFrameType,
    descUa: 'Перевірка затримки (RTT) та підтримання активності тунелю крізь NAT тайм-аути.',
    descEn: 'RTT measurement & keep-alive ping to prevent NAT gateway connection dropouts.',
    color: 'amber',
  },
];

export const ProtocolFraming: React.FC<ProtocolFramingProps> = ({ language }) => {
  const [frames, setFrames] = useState<BinaryFrame[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<BinaryFrame | null>(null);
  const [copiedHex, setCopiedHex] = useState(false);

  // Playground input state
  const [customStreamId, setCustomStreamId] = useState<number>(103);
  const [customType, setCustomType] = useState<BinaryFrameType>('DATA');
  const [customPayload, setCustomPayload] = useState<string>('GET /api/v1/metrics HTTP/1.1\\r\\nHost: api-mesh.edgeproxy.mesh\\r\\n');

  const t = {
    ua: {
      title: 'Кадрований Бінарний Протокол Тунелю',
      subtitle: 'Специфікація внутрішнього протоколу передачі даних у тунелі (1 TCP/UDP = N віртуальних потоків)',
      frameStructureTitle: 'Анатомія Бінарного Кадру (Wire Format)',
      frameFields: [
        { field: 'Stream ID', size: '4 Байти (u32)', desc: 'Унікальний ідентифікатор віртуального потоку в межах тунелю (0 reserved для Ping)' },
        { field: 'Frame Type', size: '1 Байт (u8)', desc: '0x01 (SYN/Open), 0x02 (DATA), 0x03 (FIN/Close), 0x04 (PING)' },
        { field: 'Payload Length', size: '4 Байти (u32)', desc: 'Довжина корисного навантаження в байтах (Big-Endian u32)' },
        { field: 'Payload Data', size: 'N Байтів', desc: 'Сирі байти даних (HTTP Headers, Chunked Body, або Ping Token)' },
      ],
      typesTitle: 'Таблиця Типів Кадрів',
      liveStreamTitle: 'Мультиплексовані Потоки в Реальному Часі',
      playgroundTitle: 'Інтерактивний Генератор & Hex Dump Кадру',
      encodeBtn: 'Скомпонувати & Надіслати Кадр',
      resetBtn: 'Скинути лог кадрів',
      streamIdLabel: 'Stream ID (u32):',
      typeLabel: 'Frame Type (u8):',
      payloadLabel: 'Payload Data (ASCII string):',
      hexRepresentation: 'Шістнадцятковий дамп кадру (Hex View):',
      muxSimTitle: 'Симуляція Мультиплексування 4 Потоків через 1 З\'єднання',
      singleConnNote: 'Усі ці потоки передаються почергово крізь ОДИН єдиний TLS 1.3 / QUIC сокет без додаткових рукостискань TCP/TLS.',
      copyHex: 'Копіювати Hex',
      copied: 'Скопійовано!',
    },
    en: {
      title: 'Framed Binary Tunnel Protocol',
      subtitle: 'Internal wire-format specification and multiplexing engine (1 TCP/UDP socket = N virtual streams)',
      frameStructureTitle: 'Binary Frame Anatomy (Wire Format)',
      frameFields: [
        { field: 'Stream ID', size: '4 Bytes (u32)', desc: 'Unique virtual stream identifier within the tunnel session (0 reserved for Ping)' },
        { field: 'Frame Type', size: '1 Byte (u8)', desc: '0x01 (SYN/Open), 0x02 (DATA), 0x03 (FIN/Close), 0x04 (PING)' },
        { field: 'Payload Length', size: '4 Bytes (u32)', desc: 'Payload length in bytes (Big-Endian uint32)' },
        { field: 'Payload Data', size: 'N Bytes', desc: 'Raw application bytes (HTTP Headers, Body chunks, or Ping token)' },
      ],
      typesTitle: 'Frame Types Specification',
      liveStreamTitle: 'Live Multiplexed Stream Frames',
      playgroundTitle: 'Interactive Frame Builder & Hex Inspector',
      encodeBtn: 'Encode & Transmit Frame',
      resetBtn: 'Reset Frame Log',
      streamIdLabel: 'Stream ID (u32):',
      typeLabel: 'Frame Type (u8):',
      payloadLabel: 'Payload Data (ASCII string):',
      hexRepresentation: 'Wire Binary Hex Dump (Big-Endian):',
      muxSimTitle: 'Single-Socket Stream Multiplexing Simulation',
      singleConnNote: 'All virtual streams are interleaved over ONE single TLS 1.3 / QUIC socket, avoiding connection latency.',
      copyHex: 'Copy Hex',
      copied: 'Copied!',
    },
  }[language];

  const stringToHex = (str: string): string => {
    return Array.from(new TextEncoder().encode(str))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  };

  const handleEncodeFrame = (e: React.FormEvent) => {
    e.preventDefault();
    const typeCodeMap: Record<BinaryFrameType, number> = {
      SYN: 0x01,
      DATA: 0x02,
      FIN: 0x03,
      PING: 0x04,
      PONG: 0x05,
      RST: 0x06,
      ACK: 0x07,
      METRICS: 0x08,
    };

    const typeCode = typeCodeMap[customType];
    const streamHex = customStreamId.toString(16).padStart(8, '0').toUpperCase();
    const streamFmt = `${streamHex.slice(0, 2)} ${streamHex.slice(2, 4)} ${streamHex.slice(4, 6)} ${streamHex.slice(6, 8)}`;
    const typeHex = typeCode.toString(16).padStart(2, '0').toUpperCase();
    
    const payloadBytes = new TextEncoder().encode(customPayload);
    const lenHex = payloadBytes.length.toString(16).padStart(8, '0').toUpperCase();
    const lenFmt = `${lenHex.slice(0, 2)} ${lenHex.slice(2, 4)} ${lenHex.slice(4, 6)} ${lenHex.slice(6, 8)}`;
    const payloadHexPreview = stringToHex(customPayload);

    const fullHexDump = `${streamFmt}  ${typeHex}  ${lenFmt}  ${payloadHexPreview}`;

    const newFrame: BinaryFrame = {
      id: `frame-${Date.now()}`,
      timestamp: Date.now(),
      streamId: customStreamId,
      frameType: customType,
      frameTypeCode: typeCode,
      payloadLength: payloadBytes.length,
      payloadData: customPayload,
      hexDump: fullHexDump,
      source: 'edge_gateway',
    };

    setFrames((prev) => [newFrame, ...prev]);
    setSelectedFrame(newFrame);
  };

  const copyHexDump = () => {
    if (selectedFrame) {
      navigator.clipboard.writeText(selectedFrame.hexDump);
      setCopiedHex(true);
      setTimeout(() => setCopiedHex(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[var(--paper-2)]/80 border border-[var(--line)] rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="p-2 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)]">
            <Binary className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-white font-mono">{t.title}</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">{t.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Frame Structure Visual Diagram */}
      <div className="bg-[var(--paper-2)]/90 border border-[var(--line)] rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-white font-mono flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-[var(--accent)]" />
          <span>{t.frameStructureTitle}</span>
        </h2>

        {/* Binary Frame Header Layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4 font-mono">
          <div className="bg-[var(--accent-soft)]/40 border border-[var(--accent)] rounded-lg p-3 text-center">
            <div className="text-[10px] text-[var(--accent)] uppercase tracking-wider font-semibold">Stream ID</div>
            <div className="text-sm font-bold text-white mt-1">4 Bytes (u32)</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">Offsets 0..3 (Big-Endian)</div>
          </div>
          <div className="bg-sky-950/40 border border-sky-500/50 rounded-lg p-3 text-center">
            <div className="text-[10px] text-sky-400 uppercase tracking-wider font-semibold">Frame Type</div>
            <div className="text-sm font-bold text-white mt-1">1 Byte (u8)</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">Offset 4 (0x01..0x04)</div>
          </div>
          <div className="bg-[var(--accent)]/20 border border-purple-500/50 rounded-lg p-3 text-center">
            <div className="text-[10px] text-[var(--accent)] uppercase tracking-wider font-semibold">Payload Length</div>
            <div className="text-sm font-bold text-white mt-1">4 Bytes (u32)</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">Offsets 5..8 (N Bytes)</div>
          </div>
          <div className="bg-[var(--warn)]/20 border border-[var(--warn)] rounded-lg p-3 text-center">
            <div className="text-[10px] text-[var(--warn)] uppercase tracking-wider font-semibold">Payload Data</div>
            <div className="text-sm font-bold text-white mt-1">N Bytes (Raw)</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">Offsets 9..(9 + N)</div>
          </div>
        </div>

        {/* Fields breakdown table */}
        <div className="divide-y divide-zinc-800 border border-[var(--line)]/80 rounded-lg overflow-hidden font-mono text-xs">
          {t.frameFields.map((field, idx) => (
            <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 bg-[var(--paper)]/50 hover:bg-[var(--paper-2)]/40 transition-colors">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)]"></span>
                <span className="font-bold text-white">{field.field}</span>
                <span className="text-[var(--muted)]">•</span>
                <span className="text-[var(--accent)] bg-[var(--accent-soft)]/60 px-1.5 py-0.5 rounded text-[11px] border border-[var(--accent)]">
                  {field.size}
                </span>
              </div>
              <div className="text-[var(--muted)] mt-1 sm:mt-0 text-[11px]">{field.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Frame Types Specs & Interactive Playground */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Frame Types Table */}
        <div className="lg:col-span-5 bg-[var(--paper-2)]/90 border border-[var(--line)] rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-[var(--accent)]" />
            <span>{t.typesTitle}</span>
          </h3>

          <div className="space-y-2.5">
            {FRAME_TYPES_INFO.map((item) => (
              <div
                key={item.code}
                onClick={() => setCustomType(item.type)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  customType === item.type
                    ? 'bg-[var(--paper-2)] border-emerald-500 '
                    : 'bg-[var(--paper)]/70 border-[var(--line)] hover:border-[var(--line)]'
                }`}
              >
                <div className="flex items-center justify-between font-mono">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--paper-2)] text-[var(--accent)] text-xs font-bold border border-[var(--line)]">
                      {item.code}
                    </span>
                    <span className="font-bold text-white text-xs">{item.name}</span>
                  </div>
                  <span className="text-[10px] uppercase font-mono text-[var(--muted)]">{item.type}</span>
                </div>
                <p className="text-[11px] text-[var(--muted)] mt-1.5 leading-relaxed">
                  {language === 'ua' ? item.descUa : item.descEn}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Interactive Frame Builder & Hex Inspector */}
        <div className="lg:col-span-7 bg-[var(--paper-2)]/90 border border-[var(--line)] rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[var(--accent)]" />
            <span>{t.playgroundTitle}</span>
          </h3>

          <form onSubmit={handleEncodeFrame} className="space-y-3 font-mono text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[var(--muted)] block mb-1">{t.streamIdLabel}</label>
                <input
                  type="number"
                  min="0"
                  max="4294967295"
                  value={customStreamId}
                  onChange={(e) => setCustomStreamId(parseInt(e.target.value) || 0)}
                  className="w-full bg-[var(--paper)] border border-[var(--line)] rounded px-2.5 py-1.5 text-white focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-[var(--muted)] block mb-1">{t.typeLabel}</label>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value as BinaryFrameType)}
                  className="w-full bg-[var(--paper)] border border-[var(--line)] rounded px-2.5 py-1.5 text-white focus:border-emerald-500 outline-none"
                >
                  <option value="SYN">0x01 (SYN / Open)</option>
                  <option value="DATA">0x02 (DATA)</option>
                  <option value="FIN">0x03 (FIN / Close)</option>
                  <option value="PING">0x04 (PING / Heartbeat)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[var(--muted)] block mb-1">{t.payloadLabel}</label>
              <textarea
                rows={3}
                value={customPayload}
                onChange={(e) => setCustomPayload(e.target.value)}
                className="w-full bg-[var(--paper)] border border-[var(--line)] rounded px-2.5 py-1.5 text-[var(--accent)] font-mono text-xs focus:border-emerald-500 outline-none"
                placeholder="HTTP/1.1 payload, JSON, or raw body..."
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent)] text-white font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t.encodeBtn}</span>
            </button>
          </form>

          {/* Selected Frame Detailed Hex Dump */}
          {selectedFrame && (
            <div className="bg-[var(--paper)] border border-[var(--line)] rounded-lg p-3 space-y-2 mt-4 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">{t.hexRepresentation}</span>
                <button
                  onClick={copyHexDump}
                  className="text-[var(--muted)] hover:text-white flex items-center gap-1 text-[11px]"
                >
                  {copiedHex ? <Check className="w-3 h-3 text-[var(--accent)]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedHex ? t.copied : t.copyHex}</span>
                </button>
              </div>

              {/* Hex Dump Formatted Display */}
              <div className="p-2.5 bg-[var(--paper-2)]/90 rounded border border-[var(--line)] text-xs overflow-x-auto text-[var(--accent)] font-mono select-all">
                {selectedFrame.hexDump}
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 text-[var(--muted)]">
                <div>Stream: <span className="text-white font-bold">#{selectedFrame.streamId}</span></div>
                <div>Type: <span className="text-[var(--accent)] font-bold">{selectedFrame.frameType} (0x0{selectedFrame.frameTypeCode})</span></div>
                <div>Length: <span className="text-white font-bold">{selectedFrame.payloadLength} bytes</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stream Multiplexing Visualizer (Single Socket = N Streams) */}
      <div className="bg-[var(--paper-2)]/90 border border-[var(--line)] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
          <div>
            <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
              <Zap className="w-4 h-4 text-[var(--accent)]" />
              <span>{t.muxSimTitle}</span>
            </h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">{t.singleConnNote}</p>
          </div>
          <button
            onClick={() => setFrames([])}
            className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--ink)] px-2.5 py-1 rounded bg-[var(--paper-2)]"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t.resetBtn}</span>
          </button>
        </div>

        {/* Live Frame Timeline */}
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {frames.length === 0 ? (
            <div className="py-8 text-center text-[var(--muted)] font-mono text-xs">
              {language === 'ua' ? 'Кадри відсутні. Використайте генератор вище для кодування та надсилання нового бінарного кадру.' : 'No binary frames recorded. Use the generator above to encode and transmit a binary frame.'}
            </div>
          ) : (
            frames.map((frame) => {
              const isSelected = selectedFrame?.id === frame.id;
            const typeColor = 
              frame.frameType === 'SYN' ? 'text-[var(--accent)] bg-[var(--accent-soft)]/60 border-[var(--accent)]' :
              frame.frameType === 'DATA' ? 'text-sky-400 bg-sky-950/60 border-sky-500/40' :
              frame.frameType === 'FIN' ? 'text-rose-400 bg-rose-950/60 border-rose-500/40' :
              'text-[var(--warn)] bg-[var(--warn)]/20 border-[var(--warn)]';

            return (
              <div
                key={frame.id}
                onClick={() => setSelectedFrame(frame)}
                className={`p-3 rounded-lg border font-mono text-xs cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  isSelected
                    ? 'bg-[var(--paper-2)]/90 border-emerald-500'
                    : 'bg-[var(--paper)]/60 border-[var(--line)]/80 hover:border-[var(--line)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${typeColor}`}>
                    {frame.frameType} 0x0{frame.frameTypeCode}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--muted)]">Stream</span>
                    <span className="text-white font-bold px-1.5 py-0.5 rounded bg-[var(--paper-2)] text-[11px]">
                      #{frame.streamId}
                    </span>
                  </div>
                  <span className="text-[var(--faint)] hidden sm:inline">•</span>
                  <span className="text-[var(--muted)] text-[11px] truncate max-w-xs sm:max-w-md">
                    {frame.payloadData.replace(/\\r\\n/g, ' ')}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] flex-shrink-0">
                  <span>{frame.payloadLength} B</span>
                  <span>•</span>
                  <span>{frame.source === 'edge_gateway' ? 'Edge → Agent' : 'Agent → Edge'}</span>
                </div>
              </div>
            );
          })
        )}
        </div>
      </div>
    </div>
  );
};
