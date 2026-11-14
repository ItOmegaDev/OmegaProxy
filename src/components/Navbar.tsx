import React from 'react';
import { 
  ShieldCheck, 
  Terminal, 
  Globe, 
  Radio, 
  Layers, 
  Server, 
  Flame, 
  KeyRound, 
  DownloadCloud, 
  Zap,
  Activity,
  Binary,
  Database,
  GitBranch,
  Code2
} from 'lucide-react';
import { TelemetryMetrics } from '../types';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  telemetry: TelemetryMetrics;
  isTuiMode: boolean;
  setIsTuiMode: (val: boolean) => void;
  language: 'ua' | 'en';
  setLanguage: (lang: 'ua' | 'en') => void;
  isAttackActive: boolean;
  onToggleAttack: () => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  telemetry,
  isTuiMode,
  setIsTuiMode,
  language,
  setLanguage,
  isAttackActive,
  onToggleAttack,
  theme,
  setTheme,
}) => {
  const t = {
    ua: {
      appName: 'EdgeProxy',
      badge: 'vpn.how',
      edgeStatus: 'Edge Node: Local',
      tunnelQuic: 'TCP Тунель: Активний',
      rtt: 'RTT',
      navMesh: 'Архітектура',
      navProtocol: 'Бінарний Протокол',
      navDb: 'Firestore БД',
      navCore: 'Go/SQL Ядро',
      navRoadmap: 'План Розробки',
      navTunnels: 'Тунелі',
      navTraffic: 'Live Трафік',
      navShield: 'Rate Limiter',
      navCerts: 'SSL / ACME',
      navCLI: 'CLI Агент',
      terminalMode: 'TUI Режим',
      attackRunning: 'Атака триває...',
      testAttack: 'DDoS Тест',
    },
    en: {
      appName: 'EdgeProxy',
      badge: 'vpn.how',
      edgeStatus: 'Edge Node: Local',
      tunnelQuic: 'TCP Tunnel: Active',
      rtt: 'RTT',
      navMesh: 'Architecture',
      navProtocol: 'Binary Protocol',
      navDb: 'Firestore DB',
      navCore: 'Go Core & SQL',
      navRoadmap: 'Dev Roadmap',
      navTunnels: 'Tunnels',
      navTraffic: 'Live Traffic',
      navShield: 'Rate Limiter',
      navCerts: 'SSL / ACME',
      navCLI: 'CLI & Deploy',
      terminalMode: 'TUI Mode',
      attackRunning: 'Attack Active...',
      testAttack: 'DDoS Test',
    },
  }[language];

  const navItems = [
    { id: 'topology', label: t.navMesh, icon: Layers },
    { id: 'core', label: t.navCore, icon: Code2 },
    { id: 'protocol', label: t.navProtocol, icon: Binary },
    { id: 'database', label: t.navDb, icon: Database },
    { id: 'roadmap', label: t.navRoadmap, icon: GitBranch },
    { id: 'tunnels', label: t.navTunnels, icon: Server },
    { id: 'traffic', label: t.navTraffic, icon: Activity },
    { id: 'shield', label: t.navShield, icon: ShieldCheck },
    { id: 'certs', label: t.navCerts, icon: KeyRound },
    { id: 'cli', label: t.navCLI, icon: DownloadCloud },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[color-mix(in_srgb,var(--paper)_86%,transparent)] backdrop-blur-md border-b border-[var(--line)] text-[var(--ink)] px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left branding */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--accent-soft)]/80 border border-[var(--accent)]  text-[var(--accent)]">
              <Radio className="w-5 h-5 " />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className=" absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--accent)]"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-[var(--serif)] text-xl tracking-tight text-[var(--ink)]">{t.appName}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)]">
                  {t.badge}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--paper-2)]/80 text-[var(--muted)]">
                  v2.4.1
                </span>
              </div>
              <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 font-mono">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></span>
                <span>{t.edgeStatus}</span>
                <span className="text-[var(--faint)]">•</span>
                <span className="text-[var(--accent)]/90">{t.tunnelQuic}</span>
                <span className="text-[var(--faint)]">•</span>
                <span>{t.rtt}: 14.2ms</span>
              </div>
            </div>
          </div>

          {/* Quick Attack Button on mobile */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={onToggleAttack}
              className={`text-xs px-2.5 py-1.5 rounded flex items-center gap-1 font-mono transition-colors ${
                isAttackActive 
                  ? 'bg-rose-600/90 text-white ' 
                  : 'bg-[var(--paper-2)] text-[var(--ink-2)] hover:bg-[var(--line)]'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              {isAttackActive ? t.attackRunning : t.testAttack}
            </button>
          </div>
        </div>

        {/* Center Nav tabs */}
        <nav className="flex items-center overflow-x-auto w-full md:w-auto pb-1 md:pb-0 gap-1 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id && !isTuiMode;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setIsTuiMode(false);
                  setCurrentTab(item.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)] '
                    : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)]/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right tools: Attack generator, TUI switch, language */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          {/* Quick DDoS Simulation button */}
          <button
            onClick={onToggleAttack}
            title="Simulate L7 DDoS / SYN Flood Attack to test Rate Limiter & Shield"
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
              isAttackActive
                ? 'bg-rose-500/20 border border-rose-500 text-rose-300  '
                : 'bg-[var(--paper-2)] border border-[var(--line)] text-[var(--ink-2)] hover:border-rose-500/50 hover:text-rose-300'
            }`}
          >
            <Flame className={`w-3.5 h-3.5 ${isAttackActive ? 'text-rose-400' : 'text-[var(--muted)]'}`} />
            <span>{isAttackActive ? t.attackRunning : t.testAttack}</span>
          </button>

          {/* TUI mode toggle */}
          <button
            onClick={() => setIsTuiMode(!isTuiMode)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-all border ${
              isTuiMode
                ? 'bg-[var(--warn)]/20 border-[var(--warn)] text-[var(--warn)] '
                : 'bg-[var(--paper-2)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-strong)]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.terminalMode}</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-all border bg-[var(--paper-2)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--line-strong)]"
            title="Toggle theme"
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>

          {/* Language selector */}
          <div className="flex items-center bg-[var(--paper-2)] border border-[var(--line)] rounded p-0.5 text-xs font-mono">
            <button
              onClick={() => setLanguage('ua')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                language === 'ua' ? 'bg-[var(--accent)] text-white font-bold' : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              UA
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                language === 'en' ? 'bg-[var(--accent)] text-white font-bold' : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              EN
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
