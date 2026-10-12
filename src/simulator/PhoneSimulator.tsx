import {
  BatteryMedium,
  ChevronLeft,
  Menu,
  RefreshCw,
  RotateCw,
  Signal,
  Square,
  Wifi,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

export function PhoneSimulator() {
  const [size, setSize] = useState({ width: 400, height: 866 });
  const [draftSize, setDraftSize] = useState({ width: '400', height: '866' });
  const [navigation, setNavigation] = useState('buttons');
  const [fit, setFit] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [space, setSpace] = useState({ width: 600, height: 900 });
  const stage = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLIFrameElement>(null);
  const safeBottom = navigation === 'buttons' ? 48 : 24;
  const safeTop = 30;
  const scale = fit
    ? Math.min(1, (space.width - 48) / (size.width + 18), (space.height - 40) / (size.height + 18))
    : 1;
  const zoom = Math.max(0.2, scale);

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSpace({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  function syncInsets() {
    preview.current?.contentWindow?.postMessage(
      { type: 'ludian-simulator-viewport', top: safeTop, bottom: safeBottom },
      location.origin,
    );
  }

  useEffect(() => {
    preview.current?.contentWindow?.postMessage(
      { type: 'ludian-simulator-viewport', top: safeTop, bottom: safeBottom },
      location.origin,
    );
  }, [safeBottom]);

  function resize(axis: 'width' | 'height', raw: string) {
    setDraftSize((previous) => ({ ...previous, [axis]: raw }));
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 240 || value > 1400) return;
    setSize((previous) => ({ ...previous, [axis]: Math.round(value) }));
  }

  function rotate() {
    const next = { width: size.height, height: size.width };
    setSize(next);
    setDraftSize({ width: String(next.width), height: String(next.height) });
  }

  return (
    <div className={`simulator ${showSettings ? 'show-controls' : ''}`}>
      <header className="simulator-header">
        <a href="/phone-simulator.html" className="simulator-brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>
            Ludian <span className="brand-divider">/</span> 手机模拟器
          </span>
        </a>
        <span className="dev-indicator">
          <i />
          本地开发 · 热更新
        </span>
        <button
          className="settings-toggle"
          aria-expanded={showSettings}
          onClick={() => setShowSettings(!showSettings)}
        >
          模拟设置
        </button>
      </header>
      <main className="simulator-layout">
        <aside className="simulator-controls" aria-label="手机模拟设置">
          <div className="device-intro">
            <span className="eyebrow">YOUR DEVICE</span>
            <h1>
              REDMI
              <br />
              Turbo 4 Pro
            </h1>
            <p>
              6.83 英寸 · 1280 × 2772
              <br />
              HyperOS 2 · Android
            </p>
          </div>
          <div className="control-section">
            <h2>屏幕</h2>
            <div className="dimension-fields">
              <label>
                屏幕宽度
                <input
                  type="number"
                  min="240"
                  max="1400"
                  aria-label="屏幕宽度"
                  value={draftSize.width}
                  onChange={(event) => resize('width', event.target.value)}
                  onBlur={() =>
                    setDraftSize((previous) => ({ ...previous, width: String(size.width) }))
                  }
                />
                <small>CSS px</small>
              </label>
              <span>×</span>
              <label>
                屏幕高度
                <input
                  type="number"
                  min="240"
                  max="1400"
                  aria-label="屏幕高度"
                  value={draftSize.height}
                  onChange={(event) => resize('height', event.target.value)}
                  onBlur={() =>
                    setDraftSize((previous) => ({ ...previous, height: String(size.height) }))
                  }
                />
                <small>CSS px</small>
              </label>
            </div>
            <div className="simulator-actions">
              <button onClick={rotate}>
                <RotateCw size={15} />
                旋转屏幕
              </button>
              <button onClick={() => setFit(!fit)} aria-pressed={fit}>
                {fit ? '自动适应' : '100% 尺寸'}
              </button>
            </div>
            <p className="control-note">
              默认按你的屏幕比例换算。网页视口会随手机显示缩放设置变化，可在这里调整。
            </p>
          </div>
          <div className="control-section">
            <h2>系统区域</h2>
            <label className="navigation-select">
              系统导航
              <select
                aria-label="系统导航"
                value={navigation}
                onChange={(event) => setNavigation(event.target.value)}
              >
                <option value="buttons">三按钮导航</option>
                <option value="gesture">底部手势条</option>
              </select>
            </label>
            <dl className="inset-summary">
              <div>
                <dt>顶部状态栏</dt>
                <dd>{safeTop} px</dd>
              </div>
              <div>
                <dt>底部安全区</dt>
                <dd>{safeBottom} px</dd>
              </div>
            </dl>
            <p className="control-note">系统区域单独留白，五项应用导航完整显示在它上方。</p>
          </div>
          <div className="preview-note">
            <span className="preview-dot" />
            <div>
              <strong>真实页面，可直接操作</strong>
              <p>独立的演示课表，学生名单初始为空。可切换五个页面，刷新后保留修改。</p>
            </div>
          </div>
          <button
            className="refresh-preview"
            onClick={() => preview.current?.contentWindow?.location.reload()}
          >
            <RefreshCw size={15} />
            刷新预览
          </button>
        </aside>
        <section className="simulator-stage" ref={stage} aria-label="手机屏幕预览">
          <div
            className="device-mount"
            style={{ width: (size.width + 18) * zoom, height: (size.height + 18) * zoom }}
          >
            <div
              className="phone-device"
              style={{
                width: size.width + 18,
                height: size.height + 18,
                transform: `scale(${zoom})`,
              }}
            >
              <div
                className="phone-screen"
                style={
                  {
                    width: size.width,
                    height: size.height,
                    '--system-bottom': `${safeBottom}px`,
                  } as CSSProperties
                }
              >
                <iframe
                  ref={preview}
                  title="Ludian 手机预览"
                  src="/phone-preview.html"
                  onLoad={syncInsets}
                />
                <div className="phone-status" aria-hidden="true">
                  <strong>10:05</strong>
                  <span className="camera-dot" />
                  <span>
                    <Signal size={14} />
                    <small>5G</small>
                    <Wifi size={14} />
                    <BatteryMedium size={19} />
                  </span>
                </div>
                <div
                  className={`phone-system-navigation ${navigation}`}
                  data-testid="system-navigation"
                  aria-hidden="true"
                >
                  {navigation === 'buttons' ? (
                    <>
                      <Menu size={18} />
                      <Square size={17} />
                      <ChevronLeft size={23} />
                    </>
                  ) : (
                    <span className="gesture-handle" />
                  )}
                </div>
              </div>
            </div>
          </div>
          <p className="stage-caption">
            {size.width} × {size.height} CSS px <span>·</span> {Math.round(zoom * 100)}%{' '}
            <span>·</span> 水墨江南
          </p>
        </section>
      </main>
    </div>
  );
}
