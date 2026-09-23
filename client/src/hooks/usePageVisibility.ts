import { useEffect, useState } from 'react';

export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return isVisible;
}
