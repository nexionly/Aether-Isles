import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  const label = isInstallable
    ? isAndroid
      ? 'Install Android App'
      : 'Install App'
    : isIOS
      ? 'Install on iOS'
      : 'Install on Android';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`flex items-center justify-center gap-2 rounded-lg font-medium text-[#dbe7f3] bg-[#162232]/90 border border-[#d6bc86]/30 hover:border-[#d6bc86]/60 hover:bg-[#1e2e42] transition-colors duration-150 cursor-pointer whitespace-nowrap ${
          compact ? 'px-3 py-2 text-xs w-full' : 'px-4 py-3.5 text-sm'
        }`}
      >
        {isInstallable ? <Download className="w-4 h-4 text-[#f0b429]" /> : <Smartphone className="w-4 h-4 text-[#f0b429]" />}
        {label}
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#08111e]/82 p-6">
          <div className="stone-frame rounded-xl max-w-md w-full p-6 space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-[#d6bc86]/20 pb-3">
              <h3 className="font-display text-lg font-bold text-[#f5dfaa]">
                {isIOS ? 'Install on iPhone / iPad' : 'Install on Android'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-md text-[#a9bdd2] hover:text-white hover:bg-[#233245] cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2.5 text-sm text-[#d3dfec] leading-relaxed">
                <p>1. Open this app in <strong>Safari</strong> on your device.</p>
                <p>2. Tap the <strong>Share</strong> icon in the toolbar.</p>
                <p>3. Scroll down and tap <strong>Add to Home Screen</strong> for full-screen offline play.</p>
              </div>
            ) : (
              <div className="space-y-2.5 text-sm text-[#d3dfec] leading-relaxed">
                <p>1. Open the shared app URL in <strong>Chrome</strong> on your Android phone or tablet.</p>
                <p>2. Tap the browser menu (<strong>⋮</strong>) in the top-right corner.</p>
                <p>3. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong> to launch Aether Isles full-screen with offline support and touch controls.</p>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-[#131b26] bg-[#f0b429] hover:bg-[#f7c54b] transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineNotice() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-3 left-3 z-50 stone-frame rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-medium text-[#fef08a] border-[#f0b429]/50">
      <WifiOff className="w-3.5 h-3.5 text-[#f0b429]" />
      <span>Offline Mode — Playing from cached files</span>
    </div>
  );
}
