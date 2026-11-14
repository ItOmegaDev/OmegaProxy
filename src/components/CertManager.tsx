import React, { useState } from 'react';
import { 
  KeyRound, 
  ShieldCheck, 
  RefreshCw, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Lock, 
  ExternalLink, 
  AlertCircle,
  FileCode,
  Zap,
  Globe
} from 'lucide-react';
import { SSLCertificate } from '../types';

interface CertManagerProps {
  certificates: SSLCertificate[];
  onIssueCert: (cert: Partial<SSLCertificate>) => void;
  onRenewCert: (id: string) => void;
  language: 'ua' | 'en';
}

export const CertManager: React.FC<CertManagerProps> = ({
  certificates,
  onIssueCert,
  onRenewCert,
  language,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [issueStep, setIssueStep] = useState<'form' | 'challenge' | 'issued'>('form');
  const [domainInput, setDomainInput] = useState('');
  const [challengeType, setChallengeType] = useState<'DNS-01' | 'HTTP-01'>('DNS-01');
  const [isWildcard, setIsWildcard] = useState(true);

  const t = {
    ua: {
      title: 'Автоматичний SSL / Let\'s Encrypt (ACME v2)',
      subtitle: 'Випуск та авто-оновлення Wildcard SSL-сертифікатів для піддоменів без простою сервісу',
      issueNewBtn: 'Випустити Новий Сертифікат',
      acmeStatus: 'ACME v2 Directory: З\'єднано з Let\'s Encrypt Production',
      domainCol: 'Домен / Піддомени',
      issuerCol: 'Центр Сертифікації',
      expiresCol: 'Термін дії',
      statusCol: 'Статус',
      renewCol: 'Авто-оновлення',
      actionsCol: 'Дії',
      forceRenewBtn: 'Оновити зараз',
      renewing: 'Оновлюється...',
      modalTitle: 'Випуск SSL Сертифіката (ACME v2)',
      modalSubtitle: 'Генерація ключів ECDSA P-256 та перевірка власності домену',
      domainLabel: 'Доменне ім\'я (наприклад: *.myhomelab.dev або app.mydomain.com)',
      wildcardLabel: 'Випустити Wildcard сертифікат (*.domain.com)',
      challengeLabel: 'Тип ACME перевірки:',
      dnsChallengeDesc: 'DNS-01: Створення TXT запису _acme-challenge (підходить для Wildcard)',
      httpChallengeDesc: 'HTTP-01: Перевірка через /.well-known/acme-challenge/ на 80 порту',
      startIssueBtn: 'Почати випуск сертифіката',
      verifyingTitle: 'Виконується перевірка челенджу...',
      verifyingDesc: 'OmegaProxy звертається до DNS авторитетного сервера для валідації токена',
      issuedSuccess: 'Сертифікат успішно згенеровано та встановлено в OmegaProxy!',
      closeBtn: 'Закрити',
      ocspStapled: 'OCSP Stapling: Активно',
    },
    en: {
      title: 'Automated SSL / Let\'s Encrypt (ACME v2)',
      subtitle: 'Seamless issuance & auto-renewal of Wildcard SSL certificates for all mesh subdomains',
      issueNewBtn: 'Issue New Certificate',
      acmeStatus: 'ACME v2 Directory: Connected to Let\'s Encrypt Production',
      domainCol: 'Domain / SANs',
      issuerCol: 'Certificate Authority',
      expiresCol: 'Validity',
      statusCol: 'Status',
      renewCol: 'Auto-Renew',
      actionsCol: 'Actions',
      forceRenewBtn: 'Renew Now',
      renewing: 'Renewing...',
      modalTitle: 'SSL Certificate Issuance (ACME v2)',
      modalSubtitle: 'ECDSA P-256 key generation & domain ownership verification',
      domainLabel: 'Domain Name (e.g. *.myhomelab.dev or app.mydomain.com)',
      wildcardLabel: 'Issue Wildcard Certificate (*.domain.com)',
      challengeLabel: 'ACME Challenge Type:',
      dnsChallengeDesc: 'DNS-01: TXT record _acme-challenge verification (required for Wildcards)',
      httpChallengeDesc: 'HTTP-01: HTTP route /.well-known/acme-challenge/ on port 80',
      startIssueBtn: 'Start Certificate Issuance',
      verifyingTitle: 'Verifying ACME Challenge...',
      verifyingDesc: 'OmegaProxy is checking DNS propagation for the temporary verification token',
      issuedSuccess: 'Certificate issued and hot-reloaded into OmegaProxy router!',
      closeBtn: 'Close',
      ocspStapled: 'OCSP Stapling: Active',
    },
  }[language];

  const handleStartIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput) return;
    setIssueStep('challenge');

    setTimeout(() => {
      setIssueStep('issued');
      onIssueCert({
        domain: isWildcard && !domainInput.startsWith('*.') ? `*.${domainInput}` : domainInput,
        wildcard: isWildcard,
        issuer: "Let's Encrypt Authority E1",
        status: 'valid',
        validFrom: new Date().toISOString().split('T')[0],
        validTo: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
        daysRemaining: 90,
        challengeType,
        sanList: [domainInput, `*.${domainInput}`],
        ocspStapled: true,
        fingerprint: `SHA256: ${Math.random().toString(16).substring(2, 10).toUpperCase()}:${Math.random().toString(16).substring(2, 10).toUpperCase()}`,
        autoRenew: true,
      });
    }, 1800);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setIssueStep('form');
    setDomainInput('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--paper-2)]/80 border border-[var(--line)] p-5 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)] text-[var(--accent)]">
              <KeyRound className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">{t.subtitle}</p>
        </div>

        <button
          onClick={() => {
            setIssueStep('form');
            setIsModalOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)] text-white font-mono text-sm font-semibold transition-colors shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" />
          <span>{t.issueNewBtn}</span>
        </button>
      </div>

      {/* ACME Status Banner */}
      <div className="bg-[var(--paper)]/70 border border-[var(--line)]/80 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <CheckCircle2 className="w-4 h-4 text-[var(--accent)]" />
          <span>{t.acmeStatus}</span>
        </div>
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>TLS 1.3 / ECDSA P-256</span>
          </span>
          <span>•</span>
          <span className="text-[var(--ink-2)]">{t.ocspStapled}</span>
        </div>
      </div>

      {/* Certificates Cards / Table */}
      {certificates.length === 0 ? (
        <div className="bg-[var(--paper)]/70 border border-[var(--line)]/80 rounded-xl p-8 text-center space-y-3 font-mono">
          <KeyRound className="w-10 h-10 text-[var(--faint)] mx-auto" />
          <h3 className="text-sm font-semibold text-[var(--ink-2)]">
            {language === 'ua' ? 'Немає активних SSL/TLS сертифікатів' : 'No active SSL/TLS certificates'}
          </h3>
          <p className="text-xs text-[var(--muted)] max-w-md mx-auto">
            {language === 'ua'
              ? 'Натисніть кнопку "Випустити Новий Сертифікат" для автоматичного запиту валідації ACME v2 DNS-01 або HTTP-01.'
              : 'Click "Issue New Certificate" to trigger automated ACME v2 DNS-01 or HTTP-01 issuance.'}
          </p>
          <button
            onClick={() => {
              setIssueStep('form');
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)] text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t.issueNewBtn}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {certificates.map((cert) => (
            <div
              key={cert.id}
              className="bg-[var(--paper-2)]/90 border border-[var(--line)] hover:border-[var(--line)] rounded-xl p-5 shadow-sm space-y-4 font-mono text-xs transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] "></span>
                    <h3 className="font-bold text-white text-sm tracking-wide">{cert.domain}</h3>
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mt-1">Issuer: {cert.issuer}</div>
                </div>

                <span className="px-2 py-0.5 rounded bg-[var(--accent-soft)]/80 border border-emerald-800 text-[var(--accent)] uppercase text-[10px] font-bold">
                  {cert.status}
                </span>
              </div>

              {/* SANs and challenge info */}
              <div className="bg-[var(--paper)]/80 p-3 rounded-lg border border-[var(--line)]/80 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Challenge Type:</span>
                  <span className="text-[var(--ink-2)]">{cert.challengeType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Valid Period:</span>
                  <span className="text-[var(--ink-2)]">{cert.validFrom} → {cert.validTo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Days Remaining:</span>
                  <span className="text-[var(--accent)] font-bold">{cert.daysRemaining} days</span>
                </div>
                <div className="text-[10px] text-[var(--muted)] truncate pt-1 border-t border-zinc-850">
                  Fingerprint: {cert.fingerprint}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[var(--line)] text-xs">
                <span className="text-[var(--muted)] flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>Auto-renew: ON (at 30 days)</span>
                </span>

                <button
                  onClick={() => onRenewCert(cert.id)}
                  disabled={cert.status === 'renewing'}
                  className="px-3 py-1 rounded bg-[var(--paper-2)] hover:bg-[var(--line)] text-[var(--ink)] transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${cert.status === 'renewing' ? 'animate-spin' : ''}`} />
                  <span>{cert.status === 'renewing' ? t.renewing : t.forceRenewBtn}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for Issuing New SSL Cert */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[var(--paper-2)] border border-[var(--line)] rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-start justify-between border-b border-[var(--line)] pb-3">
              <div>
                <h2 className="text-base font-bold text-white">{t.modalTitle}</h2>
                <p className="text-[11px] text-[var(--muted)] mt-0.5">{t.modalSubtitle}</p>
              </div>
              <button onClick={handleModalClose} className="text-[var(--muted)] hover:text-white">✕</button>
            </div>

            {issueStep === 'form' && (
              <form onSubmit={handleStartIssue} className="space-y-4">
                <div>
                  <label className="block text-[var(--ink-2)] mb-1">{t.domainLabel}</label>
                  <input
                    type="text"
                    required
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="myhomelab.dev"
                    className="w-full bg-[var(--paper)] border border-[var(--line)] rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-[var(--ink-2)]">
                  <input
                    type="checkbox"
                    checked={isWildcard}
                    onChange={(e) => setIsWildcard(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  <span>{t.wildcardLabel}</span>
                </label>

                <div>
                  <label className="block text-[var(--ink-2)] mb-1">{t.challengeLabel}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setChallengeType('DNS-01')}
                      className={`p-2 rounded border text-left transition-colors ${
                        challengeType === 'DNS-01'
                          ? 'bg-[var(--accent-soft)]/60 border-emerald-500 text-[var(--accent)]'
                          : 'bg-[var(--paper)] border-[var(--line)] text-[var(--muted)]'
                      }`}
                    >
                      <span className="font-bold block mb-1">DNS-01 Challenge</span>
                      <span className="text-[10px] text-[var(--muted)] leading-tight block">{t.dnsChallengeDesc}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setChallengeType('HTTP-01')}
                      className={`p-2 rounded border text-left transition-colors ${
                        challengeType === 'HTTP-01'
                          ? 'bg-[var(--accent-soft)]/60 border-emerald-500 text-[var(--accent)]'
                          : 'bg-[var(--paper)] border-[var(--line)] text-[var(--muted)]'
                      }`}
                    >
                      <span className="font-bold block mb-1">HTTP-01 Challenge</span>
                      <span className="text-[10px] text-[var(--muted)] leading-tight block">{t.httpChallengeDesc}</span>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-[var(--line)]">
                  <button
                    type="button"
                    onClick={handleModalClose}
                    className="px-4 py-2 rounded bg-[var(--paper-2)] hover:bg-[var(--line)] text-[var(--ink-2)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent)] text-white font-bold"
                  >
                    {t.startIssueBtn}
                  </button>
                </div>
              </form>
            )}

            {issueStep === 'challenge' && (
              <div className="py-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-[var(--accent)] animate-spin mx-auto" />
                <h3 className="text-white font-bold text-sm">{t.verifyingTitle}</h3>
                <p className="text-[var(--muted)] text-[11px] max-w-sm mx-auto">{t.verifyingDesc}</p>
                <div className="bg-[var(--paper)] p-2 rounded text-[10px] text-[var(--accent)] border border-[var(--line)] inline-block font-mono">
                  TXT _acme-challenge.{domainInput} → {Math.random().toString(36).substring(2, 18)}
                </div>
              </div>
            )}

            {issueStep === 'issued' && (
              <div className="py-6 text-center space-y-4">
                <CheckCircle2 className="w-10 h-10 text-[var(--accent)] mx-auto" />
                <h3 className="text-white font-bold text-sm">{t.issuedSuccess}</h3>
                <p className="text-[var(--muted)] text-[11px]">
                  ECDSA certificate active for *.${domainInput}. Traffic automatically routes over HTTPS with HTTP/3 QUIC support.
                </p>
                <button
                  onClick={handleModalClose}
                  className="px-5 py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent)] text-white font-bold"
                >
                  {t.closeBtn}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
