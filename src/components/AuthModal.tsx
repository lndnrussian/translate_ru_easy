import React, { useState } from 'react';
import { Lock, ShieldCheck, ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { verifyMasterPassword } from '../services/api';

interface AuthModalProps {
  isOpen: boolean;
  onAuthenticated: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await verifyMasterPassword(password.trim());
      setIsLoading(false);
      onAuthenticated();
    } catch (err: any) {
      setIsLoading(false);
      setError(err?.message || 'Неверный пароль. Попробуйте снова.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000]/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl border border-[#d1d5db] shadow-2xl max-w-md w-full p-6 sm:p-8 relative">
        {/* Lock Icon & Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-[#eff6ff] border border-[#bfdbfe] flex items-center justify-center text-[#2563eb] mb-3 shadow-inner">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[#1a1a1a] tracking-tight">
            Персональный доступ
          </h2>
          <p className="text-xs text-[#6b7280] mt-1 max-w-xs leading-relaxed">
            Приложение настроено для индивидуального использования. Введите мастер-пароль для доступа к переводам.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label 
              htmlFor="master-password-input" 
              className="block text-xs font-semibold text-[#374151] mb-1.5"
            >
              Пароль доступа
            </label>
            <div className="relative">
              <input
                id="master-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                autoFocus
                placeholder="Введите пароль..."
                className={`w-full px-3.5 py-2.5 text-sm bg-[#f9fafb] border rounded-lg focus:outline-none focus:ring-2 transition-all pr-10 font-mono ${
                  error
                    ? 'border-red-400 focus:ring-red-200 focus:border-red-500'
                    : 'border-[#d1d5db] focus:ring-[#3b82f6]/20 focus:border-[#2563eb]'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#4b5563] p-1"
                title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1 animate-in fade-in">
                <span>⚠️</span>
                <span>{error}</span>
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="w-full py-2.5 px-4 bg-[#2563eb] hover:bg-[#1d4ed8] text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Проверка...</span>
              </>
            ) : (
              <>
                <span>Разблокировать переводчик</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Bottom Hint */}
        <div className="mt-6 pt-4 border-t border-[#f3f4f6] flex items-center justify-between text-[11px] text-[#6b7280]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" />
            <span>Сессия сохраняется в браузере</span>
          </div>
          <div className="flex items-center gap-1 text-[#9ca3af]">
            <KeyRound className="w-3 h-3" />
            <span>Master Key Auth</span>
          </div>
        </div>
      </div>
    </div>
  );
};
