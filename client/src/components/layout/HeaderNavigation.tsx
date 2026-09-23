import { memo, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { IconType } from 'react-icons';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import { preloadRoute } from '../../routePreload';

export interface HeaderNavChild {
  path: string;
  label: string;
  end?: boolean;
  aliases?: string[];
}

export interface HeaderNavItem {
  path: string;
  label: string;
  icon: IconType;
  end?: boolean;
  aliases?: string[];
  children?: HeaderNavChild[];
  tone?: 'devtools';
  placement?: 'end';
}

interface HeaderNavigationProps {
  items: HeaderNavItem[];
  className?: string;
  linkClassName?: string;
  isMobile?: boolean;
  onNavigate?: () => void;
}

function matchesPath(pathname: string, target: string, end = false): boolean {
  if (target === '/') return pathname === '/';
  if (end) return pathname === target;
  return pathname === target || pathname.startsWith(`${target}/`);
}

function isActiveItem(pathname: string, item: HeaderNavItem): boolean {
  if (matchesPath(pathname, item.path, Boolean(item.end))) return true;
  const aliases = item.aliases ?? [];
  if (aliases.some((alias) => matchesPath(pathname, alias))) return true;

  if (item.children && item.children.length > 0) {
    return item.children.some((child) => {
      if (matchesPath(pathname, child.path, Boolean(child.end))) return true;
      return (child.aliases ?? []).some((alias) => matchesPath(pathname, alias));
    });
  }

  return false;
}

function HeaderNavigation({
  items,
  className = '',
  linkClassName = 'header-nav-link',
  isMobile = false,
  onNavigate,
}: HeaderNavigationProps) {
  const location = useLocation();
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setOpenDropdownKey(null);
  }, [location.pathname]);

  useEffect(() => {
    if (isMobile || !openDropdownKey) return;

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !navRef.current) return;
      if (!navRef.current.contains(target)) {
        setOpenDropdownKey(null);
      }
    };

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenDropdownKey(null);
      }
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [isMobile, openDropdownKey]);

  const renderSimpleLink = (item: HeaderNavItem, active: boolean) => {
    const placementClass = item.placement ? `header-nav-item-${item.placement}` : '';

    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={onNavigate}
        onMouseEnter={() => preloadRoute(item.path)}
        onFocus={() => preloadRoute(item.path)}
        onTouchStart={() => preloadRoute(item.path)}
        aria-current={active ? 'page' : undefined}
        className={`${linkClassName} ${item.tone ? `${linkClassName}-${item.tone}` : ''} ${placementClass} ${active ? 'active' : ''}`}
      >
        <item.icon className="header-nav-icon" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <nav ref={navRef} className={className} aria-label="Primary navigation">
      {items.map((item) => {
        const active = isActiveItem(location.pathname, item);
        const children = item.children ?? [];
        const toneClass = item.tone ? `header-nav-item-${item.tone}` : '';
        const placementClass = item.placement ? `header-nav-item-${item.placement}` : '';

        if (children.length === 0) {
          return renderSimpleLink(item, active);
        }

        if (isMobile) {
          return (
            <div key={item.path} className={`mobile-nav-group ${toneClass} ${placementClass}`}>
              <div className={`mobile-nav-link mobile-nav-group-label ${item.tone ? `mobile-nav-group-label-${item.tone}` : ''} ${active ? 'active' : ''}`}>
                <item.icon className="header-nav-icon" />
                <span>{item.label}</span>
              </div>
              <div className="mobile-nav-submenu">
                {children.map((child) => {
                  const childActive =
                    matchesPath(location.pathname, child.path, Boolean(child.end)) ||
                    (child.aliases ?? []).some((alias) => matchesPath(location.pathname, alias));

                  return (
                    <Link
                      key={`${item.path}-${child.path}`}
                      to={child.path}
                      onClick={onNavigate}
                      onTouchStart={() => preloadRoute(child.path)}
                      aria-current={childActive ? 'page' : undefined}
                      className={`mobile-nav-sublink ${childActive ? 'active' : ''}`}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        }

        const isOpen = openDropdownKey === item.path;

        return (
          <div key={item.path} className={`header-nav-dropdown ${toneClass} ${placementClass}`}>
            <button
              type="button"
              className={`${linkClassName} ${item.tone ? `${linkClassName}-${item.tone}` : ''} header-nav-dropdown-toggle ${active ? 'active' : ''}`}
              aria-expanded={isOpen}
              aria-haspopup="true"
              onMouseEnter={() => preloadRoute(item.path)}
              onClick={() => setOpenDropdownKey((prev) => (prev === item.path ? null : item.path))}
            >
              <item.icon className="header-nav-icon" />
              <span>{item.label}</span>
              <HiOutlineChevronDown className={`header-nav-chevron ${isOpen ? 'open' : ''}`} />
            </button>
            {isOpen && (
              <div className="header-nav-dropdown-menu" role="menu">
                {children.map((child) => {
                  const childActive =
                    matchesPath(location.pathname, child.path, Boolean(child.end)) ||
                    (child.aliases ?? []).some((alias) => matchesPath(location.pathname, alias));

                  return (
                    <Link
                      key={`${item.path}-${child.path}`}
                      to={child.path}
                      role="menuitem"
                      onMouseEnter={() => preloadRoute(child.path)}
                      onFocus={() => preloadRoute(child.path)}
                      onClick={() => {
                        setOpenDropdownKey(null);
                        onNavigate?.();
                      }}
                      aria-current={childActive ? 'page' : undefined}
                      className={`header-nav-dropdown-item ${childActive ? 'active' : ''}`}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default memo(HeaderNavigation);
