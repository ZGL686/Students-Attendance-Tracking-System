import { Check, Image, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { builtinThemes, findBuiltinTheme, themeCategories } from './builtins';
import { themeStyles } from './runtime';
import type { BuiltinTheme, ThemeDefinition } from './schema';
import '../../styles/theme-packs.css';

function ThemePreview({ theme, dark }: { theme: BuiltinTheme | null; dark: boolean }) {
  return (
    <div
      className={`pack-preview ${theme ? 'decorated' : ''}`}
      data-preview-mode={dark ? 'dark' : 'light'}
      style={theme ? themeStyles(theme, dark) : undefined}
    >
      {theme && <img src={theme.imageUrl} alt="" className="pack-preview-backdrop" />}
      <div className="pack-preview-sidebar">
        <strong>Ludian</strong>
        <span>本周课表</span>
        <span>考勤登记</span>
        <span>班级数据</span>
      </div>
      <div className="pack-preview-main">
        <span className="pack-preview-eyebrow">记录日常 · 留下成长</span>
        <h4>今天，也从容一点。</h4>
        <div className="pack-preview-cells">
          <span>
            09:20
            <br />
            <strong>课堂时光</strong>
          </span>
          <span>
            14:00
            <br />
            <strong>新的收获</strong>
          </span>
        </div>
        <span className="pack-preview-action">开始记录</span>
      </div>
    </div>
  );
}
export function ThemeGallery() {
  const { preferences, setPreferences } = usePreferences();
  const [preview, setPreview] = useState<BuiltinTheme | 'classic' | null>(null);
  const [previewDark, setPreviewDark] = useState(false);
  const [filter, setFilter] = useState<'all' | ThemeDefinition['category']>('all');
  const themes = builtinThemes.filter(
    (theme) => filter === 'all' || theme.definition.category === filter,
  );
  function openPreview(theme: BuiltinTheme | 'classic') {
    setPreviewDark(
      preferences.theme === 'dark' ||
        (preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
    );
    setPreview(theme);
  }
  function apply() {
    if (!preview) return;
    setPreferences({
      themePackId: preview === 'classic' ? 'classic' : preview.definition.id,
      themePackVersion: preview === 'classic' ? '1.0.0' : preview.definition.version,
    });
    setPreview(null);
  }
  return (
    <section className="appearance-section theme-library">
      <div className="appearance-heading">
        <div>
          <h3>让日常有自己的风景</h3>
          <p>
            {builtinThemes.length}{' '}
            套完整视觉主题，全部内置。先预览，再应用；明暗、字体与动效继续由你决定。
          </p>
        </div>
      </div>
      <div className="pack-filter" role="group" aria-label="主题风格">
        <Button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          全部主题
        </Button>
        {Object.entries(themeCategories).map(([key, label]) => (
          <Button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key as ThemeDefinition['category'])}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="pack-count" aria-live="polite">
        {filter === 'all'
          ? `${themes.length} 套主题与经典外观`
          : `${themeCategories[filter]} · ${themes.length} 套主题`}
      </p>
      <div className="pack-grid">
        {filter === 'all' && (
          <Button
            className="pack-card classic-card"
            onClick={() => openPreview('classic')}
            aria-label="预览经典主题"
            aria-pressed={preferences.themePackId === 'classic'}
          >
            <div className="pack-card-image classic-swatch">
              <Image size={28} />
              <span>简单、专注、熟悉。</span>
            </div>
            <span className="pack-card-copy">
              <strong>
                经典 Ludian {preferences.themePackId === 'classic' && <Check size={16} />}
              </strong>
              <small>原有外观 · 始终可用</small>
            </span>
          </Button>
        )}
        {themes.map((theme) => (
          <Button
            key={theme.definition.id}
            className="pack-card"
            onClick={() => openPreview(theme)}
            aria-label={`预览${theme.definition.name}`}
            aria-pressed={preferences.themePackId === theme.definition.id}
          >
            <img className="pack-card-image" src={theme.imageUrl} alt="" loading="lazy" />
            <span className="pack-card-copy">
              <strong>
                {theme.definition.name}
                {preferences.themePackId === theme.definition.id && <Check size={16} />}
              </strong>
              <small>{themeCategories[theme.definition.category]} · 内置主题</small>
            </span>
          </Button>
        ))}
      </div>
      <p className="appearance-note">所有主题随应用提供，可离线使用；外观选择仅保存在这台设备。</p>
      {preferences.themePackId !== 'classic' && !findBuiltinTheme(preferences.themePackId) && (
        <p className="appearance-note">
          之前选择的主题不在本版中，已使用经典外观，可重新选择喜欢的主题。
        </p>
      )}
      {preview && (
        <Modal
          title={preview === 'classic' ? '经典 Ludian' : preview.definition.name}
          subtitle={
            preview === 'classic'
              ? '熟悉的简洁外观，保持清晰与专注。'
              : preview.definition.description
          }
          onClose={() => setPreview(null)}
          wide
        >
          <div className="pack-preview-toggle">
            <span>
              <Sparkles size={16} />
              主题预览
            </span>
            <label className="check-label">
              <input
                type="checkbox"
                checked={previewDark}
                onChange={(event) => setPreviewDark(event.target.checked)}
              />
              预览深色
            </label>
          </div>
          <ThemePreview theme={preview === 'classic' ? null : preview} dark={previewDark} />
          <p className="appearance-note">
            预览不会更改当前界面。应用主题后，继续使用你选择的明暗、字体和动效设置。
          </p>
          <div className="pack-preview-footer">
            <Button onClick={() => setPreview(null)}>取消</Button>
            <Button className="primary" onClick={apply}>
              应用主题
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
