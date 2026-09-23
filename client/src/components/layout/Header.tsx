import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HiOutlineBars3,
  HiOutlineCodeBracket,
  HiOutlineCpuChip,
  HiOutlineCube,
  HiOutlineGlobeAlt,
  HiOutlineInformationCircle,
  HiOutlineMoon,
  HiOutlineServerStack,
  HiOutlineSquares2X2,
  HiOutlineSun,
  HiOutlineWrenchScrewdriver,
  HiOutlineXMark,
} from 'react-icons/hi2';
import { useTheme } from '../../context/ThemeContext';
import HeaderNavigation, { type HeaderNavItem } from './HeaderNavigation';
import HeaderStatusChips from './HeaderStatusChips';
import './Header.css';

const DEV_TOOLS_NAV_ITEM: HeaderNavItem = {
  path: '/provider-tags',
  label: 'Dev Tools',
  icon: HiOutlineWrenchScrewdriver,
  tone: 'devtools',
  placement: 'end',
  aliases: [
    '/provider-tags',
    '/devtools/provider-tags',
    '/devtools/pose-penalty',
    '/devtools/node-inventory',
    '/devtools/network-noise',
    '/ban-detection',
  ],
  children: [
    { path: '/ban-detection', label: 'PoSe Watch' },
    { path: '/chain-health', label: 'Nodes' },
    { path: '/devtools/node-inventory', label: 'Node Inventory' },
    { path: '/devtools/network-noise', label: 'Network Noise Monitor' },
    { path: '/devtools/pose-penalty', label: 'PoSe Penalty Watch' },
  ],
};

const NAV_ITEMS: HeaderNavItem[] = [
  { path: '/', label: 'Dashboard', icon: HiOutlineSquares2X2, end: true },
  {
    path: '/blocks',
    label: 'Explorer',
    icon: HiOutlineCube,
    aliases: ['/block', '/tx', '/txs', '/search', '/searchv2', '/address', '/wallets', '/richlist', '/mempool', '/bubblemaps'],
    children: [
      { path: '/blocks', label: 'Latest Blocks' },
      { path: '/txs', label: 'Transactions' },
      { path: '/wallets', label: 'Top Wallets' },
      { path: '/richlist', label: 'Rich List' },
    ],
  },
  {
    path: '/network',
    label: 'Network',
    icon: HiOutlineGlobeAlt,
    aliases: ['/chain-health', '/crawler'],
    children: [
      { path: '/network', label: 'Network Overview' },
      { path: '/chain-health', label: 'Nodes' },
    ],
  },
  {
    path: '/masternodes',
    label: 'Masternodes',
    icon: HiOutlineServerStack,
    aliases: ['/mn-health'],
  },
  { path: '/mining', label: 'Rewards', icon: HiOutlineCpuChip },
  { path: '/api', label: 'API', icon: HiOutlineCodeBracket },
  { path: '/about', label: 'About', icon: HiOutlineInformationCircle },
  DEV_TOOLS_NAV_ITEM,
];

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const MOBILE_BREAKPOINT = 1080;

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        setMobileOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <header className="header">
      <div className="header-shell container">
        <div className="header-top">
          <Link to="/" className="header-brand" onClick={closeMobile}>
            <span className="header-brand-title">DeFCoN Explorer</span>
            <span className="header-brand-subtitle">Live Network Monitor</span>
          </Link>

          <div className="header-top-actions">
            <HeaderStatusChips />

            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <HiOutlineSun /> : <HiOutlineMoon />}
            </button>

            <button
              type="button"
              className="mobile-toggle"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileOpen ? <HiOutlineXMark /> : <HiOutlineBars3 />}
            </button>
          </div>
        </div>

        <div className="header-nav-shell">
          <HeaderNavigation items={NAV_ITEMS} className="header-nav" onNavigate={closeMobile} />
        </div>
      </div>

      <div className={`mobile-drawer ${mobileOpen ? 'open' : ''}`}>
        <div className="mobile-drawer-inner container">
          <HeaderStatusChips compact />
          <HeaderNavigation
            items={NAV_ITEMS}
            className="mobile-nav"
            linkClassName="mobile-nav-link"
            isMobile
            onNavigate={closeMobile}
          />
        </div>
      </div>

      {mobileOpen && (
        <button
          type="button"
          className="mobile-overlay"
          onClick={closeMobile}
          aria-label="Close menu overlay"
        />
      )}
    </header>
  );
}
