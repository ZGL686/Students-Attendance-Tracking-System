import {
  AlertCircle,
  Check,
  FileUp,
  HardDrive,
  LoaderCircle,
  PanelLeft,
  PanelLeftClose,
  Settings2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { version } from '../../package.json';
import { Button, IconButton } from '../components/ui';
import { useApp } from '../context';
import { usePreferences } from '../preferences/PreferencesProvider';
import { isAndroid } from '../platform';
import type { PageId } from './navigation';
import { mobilePages, pages, primaryPages } from './navigation';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function AppShell({
  page,
  navigate,
  onNew,
  onManage,
  onSwitch,
  now,
  mobile = isAndroid,
  children,
}: {
  page: PageId;
  navigate: (page: PageId) => void;
  onNew: () => void;
  onManage: () => void;
  onSwitch: () => void;
  now: { date: string; time: string };
  mobile?: boolean;
  children: ReactNode;
}) {
  const { w, busy, saveFailed: failed } = useApp();
  const { preferences, setPreferences } = usePreferences();
  const collapsed = preferences.sidebarCollapsed;
  const PageIcon = pages[page].icon;
  return (
    <div
      className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}
      data-mobile={mobile || undefined}
    >
      {!mobile && (
        <aside id="app-sidebar" className="sidebar" inert={collapsed} aria-hidden={collapsed}>
          <WorkspaceSwitcher onNew={onNew} onManage={onManage} onSwitch={onSwitch} />
          <div className="sidebar-caption">班级管理</div>
          <nav aria-label="工作空间页面">
            {primaryPages.map((id) => {
              const { title, icon: Icon } = pages[id];
              return (
                <Button
                  key={id}
                  aria-label={title}
                  className={page === id ? 'active' : ''}
                  aria-current={page === id ? 'page' : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon size={18} strokeWidth={1.65} />
                  <span>{title}</span>
                  {id === 'students' && <small>{w.students.length}</small>}
                  {id === 'records' && <small>{w.records.filter((r) => !r.voided).length}</small>}
                </Button>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <Button onClick={onNew}>
              <FileUp size={17} />
              <span>导入学生名单</span>
            </Button>
            <Button
              className={page === 'settings' ? 'active' : ''}
              onClick={() => navigate('settings')}
            >
              <Settings2 size={17} />
              <span>设置与偏好</span>
            </Button>
            <div className="local-status">
              <HardDrive size={13} />
              <span>Ludian</span>
              <small>v{version}</small>
            </div>
          </div>
        </aside>
      )}
      <main className="app-main">
        <header className="topbar">
          <div>
            {!mobile && (
              <IconButton
                label={collapsed ? '展开侧栏' : '收起侧栏'}
                aria-expanded={!collapsed}
                aria-controls="app-sidebar"
                onClick={() => setPreferences({ sidebarCollapsed: !collapsed })}
              >
                {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
              </IconButton>
            )}
            <span className="breadcrumb-home">{w.name}</span>
            {!mobile && (
              <>
                <span className="breadcrumb-slash">/</span>
                <PageIcon size={14} />
                <span>{pages[page].title}</span>
              </>
            )}
          </div>
          <div>
            <span
              className={`saved-status ${busy ? 'is-saving' : failed ? 'save-failed' : ''}`}
              aria-live="polite"
            >
              {busy ? (
                <LoaderCircle className="pending-icon" size={13} />
              ) : failed ? (
                <AlertCircle size={13} />
              ) : (
                <Check size={13} />
              )}
              {busy ? '保存中…' : failed ? '保存未完成' : '已保存'}
            </span>
            <span className="beijing-clock">
              {now.date} · {now.time}
            </span>
          </div>
        </header>
        <div className="main-scroll">{children}</div>
      </main>
      {mobile && (
        <nav className="mobile-navigation" aria-label="主要页面">
          {mobilePages.map((id) => {
            const { title, icon: Icon } = pages[id];
            return (
              <Button
                key={id}
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={20} strokeWidth={1.8} />
                <span>{title}</span>
              </Button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
