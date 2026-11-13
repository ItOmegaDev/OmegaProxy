import React, { useState } from 'react';
import { 
  Activity, 
  RotateCw, 
  Pause, 
  Play, 
  Filter, 
  Trash2, 
  ShieldAlert, 
  CheckCircle2, 
  Clock, 
  ArrowUpRight, 
  Layers, 
  ExternalLink,
  Lock,
  Search
} from 'lucide-react';
import { TrafficRequest } from '../types';

interface TrafficInspectorProps {
  requests: TrafficRequest[];
  onReplayRequest: (req: TrafficRequest) => void;
  onClearLogs: () => void;
  language: 'ua' | 'en';
}

export const TrafficInspector: React.FC<TrafficInspectorProps> = ({
  requests,
  onReplayRequest,
  onClearLogs,
  language,
}) => {
  const [selectedRequest, setSelectedRequest] = useState<TrafficRequest | null>(null);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '4xx' | 'blocked'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const t = {
    ua: {
      title: 'Аналізатор Трафіку в Реальному Часі',
      subtitle: 'Низькорівневий інспектор HTTP/2, QUIC та WebSocket запитів з часовою розбивкою затримки',
      totalReqs: 'Всього зафіксовано запитів:',
      filterAll: 'Всі',
      filter2xx: '2xx Успішні',
      filter4xx: '429 Rate Limit',
      filterBlocked: '403 Заблоковано',
      pauseLive: 'Пауза потоку',
      resumeLive: 'Відновити потік',
      clear: 'Очистити логи',
      searchPlaceholder: 'Пошук за IP або шляхом URL...',
      replayBtn: 'Повторити запит (Replay)',
      detailTitle: 'Деталі Мережевого Запиту',
      timingWaterfall: 'Розбивка затримки (Timing Waterfall):',
      edgeIngress: 'Edge Router & TLS розшифрування',
      tunnelTransit: 'Зашифрований тунель (QUIC/HTTP2)',
      localService: 'Обробка локальним сервісом',
      reqHeaders: 'Заголовки Запиту (Client Headers)',
      resHeaders: 'Заголовки Відповіді (Edge Headers)',
      emptyLogs: 'Логів поки немає. Надішліть тестовий запит або увімкніть симулятор.',
    },
    en: {
      title: 'Real-time Live Traffic Inspector',
      subtitle: 'Low-level HTTP/2, QUIC, and WebSocket stream inspector with latency waterfall analysis',
      totalReqs: 'Total requests logged:',
      filterAll: 'All',
      filter2xx: '2xx Success',
      filter4xx: '429 Rate Limited',
      filterBlocked: '403 Blocked',
      pauseLive: 'Pause Stream',
      resumeLive: 'Resume Stream',
      clear: 'Clear Logs',
      searchPlaceholder: 'Filter by IP or URL path...',
      replayBtn: 'Replay Request',
      detailTitle: 'Network Request Inspection',
      timingWaterfall: 'Timing Waterfall Breakdown:',
      edgeIngress: 'Edge Router & TLS Decryption',
      tunnelTransit: 'Encrypted Tunnel Transit (QUIC/H2)',
      localService: 'Local Machine Processing',
      reqHeaders: 'Request Headers (Client)',
      resHeaders: 'Response Headers (Edge)',
      emptyLogs: 'No traffic logged yet. Fire a test request or enable simulator.',
    },
  }[language];

  const filtered = requests.filter((req) => {
    if (statusFilter === '2xx' && (req.statusCode < 200 || req.statusCode >= 300)) return false;
    if (statusFilter === '4xx' && req.statusCode !== 429) return false;
    if (statusFilter === 'blocked' && req.decision !== 'blocked_ddos' && req.statusCode !== 403) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        req.path.toLowerCase().includes(q) ||
        req.clientIp.includes(q) ||
        req.subdomain.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getStatusColor = (code: number, decision: string) => {
    if (decision === 'blocked_ddos' || code === 403) return 'bg-rose-950/80 text-rose-400 border-rose-800';
    if (decision === 'rate_limited' || code === 429) return 'bg-amber-950/80 text-amber-300 border-amber-800';
    if (code >= 200 && code < 300) return 'bg-[var(--accent-soft)]/80 text-[var(--accent)] border-emerald-800';
    if (code >= 300 && code < 400) return 'bg-sky-950/80 text-sky-300 border-sky-800';
    return 'bg-[var(--paper-2)] text-[var(--ink-2)] border-[var(--line)]';
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET':
        return 'text-sky-400 bg-sky-950/60 border-sky-800';
      case 'POST':
        return 'text-[var(--accent)] bg-[var(--accent-soft)]/60 border-emerald-800';
      case 'PUT':
        return 'text-amber-400 bg-amber-950/60 border-amber-800';
      case 'DELETE':
        return 'text-rose-400 bg-rose-950/60 border-rose-800';
      default:
        return 'text-[var(--muted)] bg-[var(--paper-2)] border-[var(--line)]';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--paper-2)]/80 border border-[var(--line)] p-5 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)]">
              <Activity className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">{t.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLivePaused(!isLivePaused)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-medium transition-colors ${
              isLivePaused
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-[var(--paper-2)] border-[var(--line)] text-[var(--ink-2)] hover:text-white'
            }`}
          >
            {isLivePaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{isLivePaused ? t.resumeLive : t.pauseLive}</span>
          </button>

          <button
            onClick={onClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--paper-2)] border border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--muted)] hover:text-white text-xs font-mono transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.clear}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[var(--paper)]/70 p-3 rounded-xl border border-[var(--line)]">
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 scrollbar-none font-mono text-xs">
          {(['all', '2xx', '4xx', 'blocked'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1 rounded transition-colors whitespace-nowrap ${
                statusFilter === filter
                  ? 'bg-[var(--accent)] text-white font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)]'
              }`}
            >
              {filter === 'all' && t.filterAll}
              {filter === '2xx' && t.filter2xx}
              {filter === '4xx' && t.filter4xx}
              {filter === 'blocked' && t.filterBlocked}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full bg-[var(--paper-2)] border border-[var(--line)] rounded px-2.5 py-1 text-xs font-mono text-[var(--ink)] placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Main Request Stream Table */}
      <div className="bg-[var(--paper)] border border-[var(--line)] rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-[var(--paper-2)]/90 border-b border-[var(--line)] text-[var(--muted)] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Time</th>
                <th className="py-2.5 px-3">Method</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Host & Path</th>
                <th className="py-2.5 px-3">Client IP</th>
                <th className="py-2.5 px-3">Proto</th>
                <th className="py-2.5 px-3">Latency</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-850">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--muted)]">
                    {t.emptyLogs}
                  </td>
                </tr>
              ) : (
                filtered.map((req) => {
                  const dateStr = new Date(req.timestamp).toLocaleTimeString();
                  const isSelected = selectedRequest?.id === req.id;

                  return (
                    <tr
                      key={req.id}
                      onClick={() => setSelectedRequest(req)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--accent-soft)]/40 border-l-2 border-emerald-400'
                          : 'hover:bg-[var(--paper-2)]/60'
                      }`}
                    >
                      <td className="py-2 px-3 text-[var(--muted)] whitespace-nowrap">{dateStr}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${getMethodColor(
                            req.method
                          )}`}
                        >
                          {req.method}
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${getStatusColor(
                            req.statusCode,
                            req.decision
                          )}`}
                        >
                          {req.statusCode}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-white max-w-xs truncate">
                        <span className="text-[var(--muted)]">{req.subdomain}.edgeproxy.mesh</span>
                        <span className="text-[var(--ink)] font-medium">{req.path}</span>
                      </td>
                      <td className="py-2 px-3 text-[var(--muted)] whitespace-nowrap">
                        <span className="text-[10px] px-1 py-0.2 rounded bg-[var(--paper-2)] text-[var(--ink-2)] mr-1.5">
                          {req.countryCode}
                        </span>
                        <span>{req.clientIp}</span>
                      </td>
                      <td className="py-2 px-3 text-[var(--muted)] uppercase text-[10px] whitespace-nowrap">
                        {req.protocol}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            req.durationMs > 40
                              ? 'text-amber-400'
                              : req.durationMs > 80
                              ? 'text-rose-400'
                              : 'text-[var(--accent)]'
                          }`}
                        >
                          {req.durationMs}ms
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onReplayRequest(req);
                          }}
                          className="px-2 py-0.5 rounded bg-[var(--paper-2)] hover:bg-[var(--line)] text-[var(--ink-2)] hover:text-white text-[11px] transition-colors"
                          title={t.replayBtn}
                        >
                          Replay
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Request Inspection Modal / Drawer */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[var(--paper-2)] border border-[var(--line)] rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-[var(--line)] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded border font-mono text-xs font-bold ${getMethodColor(
                      selectedRequest.method
                    )}`}
                  >
                    {selectedRequest.method}
                  </span>
                  <span className="text-white font-mono font-bold text-sm">{selectedRequest.path}</span>
                  <span
                    className={`px-2 py-0.5 rounded border font-mono text-xs font-bold ${getStatusColor(
                      selectedRequest.statusCode,
                      selectedRequest.decision
                    )}`}
                  >
                    {selectedRequest.statusCode}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted)] font-mono mt-1">
                  Host: {selectedRequest.host} • Client: {selectedRequest.clientIp} ({selectedRequest.countryCode})
                </div>
              </div>

              <button
                onClick={() => setSelectedRequest(null)}
                className="text-[var(--muted)] hover:text-[var(--ink-2)] font-mono text-sm"
              >
                ✕
              </button>
            </div>

            {/* Timing Waterfall */}
            <div className="bg-[var(--paper)] p-4 rounded-lg border border-[var(--line)] font-mono text-xs space-y-3">
              <div className="text-[var(--ink-2)] font-bold flex items-center justify-between">
                <span>{t.timingWaterfall}</span>
                <span className="text-[var(--accent)]">{selectedRequest.durationMs}ms total</span>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)] mb-1">
                    <span>{t.edgeIngress}</span>
                    <span className="text-white">{selectedRequest.edgeProcessingMs}ms</span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--paper-2)] rounded-full overflow-hidden">
                    <div className="h-full bg-sky-400" style={{ width: '8%' }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)] mb-1">
                    <span>{t.tunnelTransit}</span>
                    <span className="text-white">{selectedRequest.tunnelTransitMs}ms</span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--paper-2)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--accent)]" style={{ width: '60%' }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--muted)] mb-1">
                    <span>{t.localService}</span>
                    <span className="text-white">{selectedRequest.localServiceMs}ms</span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--paper-2)] rounded-full overflow-hidden">
                    <div className="h-full bg-teal-400" style={{ width: '32%' }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Security & TLS Info */}
            <div className="bg-[var(--paper)] p-3 rounded-lg border border-[var(--line)] font-mono text-xs grid grid-cols-2 gap-2">
              <div>
                <span className="text-[var(--muted)] block text-[10px] uppercase">TLS Cipher</span>
                <span className="text-[var(--ink-2)]">{selectedRequest.tlsCipher}</span>
              </div>
              <div>
                <span className="text-[var(--muted)] block text-[10px] uppercase">Rate Limit Decision</span>
                <span className="text-[var(--accent)] font-bold uppercase">{selectedRequest.decision}</span>
              </div>
            </div>

            {/* Headers Preview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
              <div className="bg-[var(--paper)] p-3 rounded-lg border border-[var(--line)]">
                <span className="text-[var(--muted)] font-bold block mb-2">{t.reqHeaders}</span>
                <div className="space-y-1 max-h-36 overflow-y-auto text-[11px]">
                  {Object.entries(selectedRequest.requestHeaders).map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="text-[var(--accent)]">{k}: </span>
                      <span className="text-[var(--ink-2)]">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[var(--paper)] p-3 rounded-lg border border-[var(--line)]">
                <span className="text-[var(--muted)] font-bold block mb-2">{t.resHeaders}</span>
                <div className="space-y-1 max-h-36 overflow-y-auto text-[11px]">
                  {Object.entries(selectedRequest.responseHeaders).map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="text-sky-400">{k}: </span>
                      <span className="text-[var(--ink-2)]">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Replay Request Button */}
            <div className="flex items-center justify-between pt-3 border-t border-[var(--line)] font-mono text-xs">
              <span className="text-[var(--muted)]">Payload: {selectedRequest.bytes} bytes</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onReplayRequest(selectedRequest);
                    setSelectedRequest(null);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent)] text-white font-bold transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>{t.replayBtn}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
