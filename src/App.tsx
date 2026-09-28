import { Fragment, useEffect, useState, type ComponentType } from 'react';
import { FlipPage } from './ui/FlipPage';
import { ItemsPage } from './ui/ItemsPage';
import { RecipesPage } from './ui/RecipesPage';
import { SettingsPage } from './ui/SettingsPage';
import { WorkflowsPage } from './ui/WorkflowsPage';

/**
 * `divider` starts a new group: workflows and flips are personal data, items and recipes game
 * data, and settings covers both.
 */
const TABS = [
  { key: 'workflows', label: 'Workflows', Page: WorkflowsPage },
  { key: 'flip', label: 'AH flip', Page: FlipPage },
  { key: 'items', label: 'Items', Page: ItemsPage, divider: true },
  { key: 'recipes', label: 'Recipes', Page: RecipesPage },
  { key: 'settings', label: 'Settings', Page: SettingsPage, divider: true },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** The hash is `#tab` or `#tab/sub`, where sub picks a section inside the tab. */
const fromHash = (): { tab: TabKey; sub?: string } => {
  const h = window.location.hash.slice(1);
  // Disenchant rules used to be a top-level tab.
  if (h === 'disenchant') return { tab: 'settings', sub: 'disenchant' };
  const [key, sub] = h.split('/');
  const tab = (TABS.find((t) => t.key === key)?.key ?? 'workflows') as TabKey;
  return { tab, sub };
};

export function App() {
  const [{ tab, sub }, setRoute] = useState(fromHash);
  useEffect(() => {
    const onHash = () => setRoute(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const Page: ComponentType<{ sub?: string }> = TABS.find((t) => t.key === tab)!.Page;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="coin" aria-hidden />
          Harmless Tradeskills
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <Fragment key={t.key}>
              {'divider' in t && <span className="tab-divider" aria-hidden />}
              <a href={`#${t.key}`} className={t.key === tab ? 'on' : ''}>
                {t.label}
              </a>
            </Fragment>
          ))}
        </nav>
      </header>
      <main className="content">
        <Page sub={sub} />
      </main>
    </div>
  );
}
