import { Fragment, useEffect, useState, type ComponentType } from 'react';
import { FlipPage } from './ui/FlipPage';
import { Icon } from './ui/icons';
import { ItemsPage } from './ui/ItemsPage';
import { RecipesPage } from './ui/RecipesPage';
import { SettingsPage } from './ui/SettingsPage';
import { WorkflowsPage } from './ui/WorkflowsPage';

/** Tabs come in groups by the data they show; the first tab of a group carries the group. */
const PERSONAL = { icon: 'person', title: 'Your data: workflows, flip favorites, prices' } as const;
const GAME = { icon: 'book', title: 'Game data: items, recipes, disenchant rules' } as const;

const TABS = [
  { key: 'workflows', label: 'Workflows', Page: WorkflowsPage, group: PERSONAL },
  { key: 'flip', label: 'AH flip', Page: FlipPage },
  { key: 'items', label: 'Items', Page: ItemsPage, group: GAME },
  { key: 'recipes', label: 'Recipes', Page: RecipesPage },
  // Settings covers both kinds of data, so it stands alone with its own icon.
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
              {'group' in t && t.key !== TABS[0].key && <span className="tab-divider" aria-hidden />}
              {'divider' in t && <span className="tab-divider" aria-hidden />}
              {'group' in t && (
                <span className="tab-group" title={t.group.title} aria-label={t.group.title} role="img">
                  <Icon name={t.group.icon} />
                </span>
              )}
              <a href={`#${t.key}`} className={t.key === tab ? 'on' : ''}>
                {t.key === 'settings' && <Icon name="cog" />}
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
