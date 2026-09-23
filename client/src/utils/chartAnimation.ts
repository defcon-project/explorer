import { useEffect, useState } from 'react';

const BASE_CHART_ANIMATION = {
  isAnimationActive: true,
  // Keep only a near-instant intro animation on first mount.
  animationBegin: 0,
  animationDuration: 70,
  animationEasing: 'linear' as const,
};

const CHART_ANIMATION_DISABLED = {
  ...BASE_CHART_ANIMATION,
  isAnimationActive: false,
};

const DISABLE_AFTER_MS = BASE_CHART_ANIMATION.animationBegin + BASE_CHART_ANIMATION.animationDuration + 30;

// Backward compatibility for pages/components not yet migrated to useChartAnimation().
export const CHART_ANIMATION = BASE_CHART_ANIMATION;

/**
 * Enables chart animation only for initial mount. Subsequent refetches/rerenders
 * keep animations off to avoid timeline jank on frequently polling pages.
 */
export function useChartAnimation() {
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsActive(false), DISABLE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return isActive ? BASE_CHART_ANIMATION : CHART_ANIMATION_DISABLED;
}
