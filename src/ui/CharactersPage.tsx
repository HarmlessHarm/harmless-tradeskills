import { useMemo, useState } from 'react';
import { characterRecipes, type RecipeKnowledge, type RecipeStatus } from '../engine/characters';
import type { Character, CharacterProfession, Faction } from '../engine/types';
import { learnedFromText, professionOptions } from '../professions';
import { useStore } from '../state/store';
import { wowheadUrl } from '../wowhead/adapter';
import { NumberInput, Panel, Segmented } from './common';
import { SkillLevels } from './skill';

const newCharacter = (name: string): Character => ({
  id: 0,
  name,
  realm: '',
  faction: null,
  level: null,
  notes: '',
  professions: [],
  learned: [],
  updatedAt: Date.now(),
});

const professionsText = (c: Character) => c.professions.map((p) => `${p.profession} ${p.skill}`).join(' · ');

export function CharactersPage() {
  const { characters, mutate } = useStore();
  const [selectedId, setSelectedId] = useState<number | null>(characters[0]?.id ?? null);
  const selected = characters.find((c) => c.id === selectedId) ?? characters[0] ?? null;

  const create = () => setSelectedId(mutate((repo) => repo.saveCharacter(newCharacter('New character'))));

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Characters</h2>
          <button onClick={create}>New</button>
        </div>
        {characters.length === 0 && <p className="muted small">No characters yet.</p>}
        <ul className="wf-list">
          {characters.map((c) => (
            <li key={c.id}>
              <button className={`wf-item ${selected?.id === c.id ? 'on' : ''}`} onClick={() => setSelectedId(c.id)}>
                <span className="wf-name">
                  {c.name}
                  {c.realm && <span className="muted"> - {c.realm}</span>}
                </span>
                <span className="wf-sub muted">{professionsText(c) || 'no professions'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="main">
        {selected ? (
          <CharacterEditor key={selected.id} char={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <Panel title="No character selected">
            <p>Add your characters with their professions and skill to see which recipes each one knows.</p>
            <p className="muted">
              Trainer recipes count as known once the skill is high enough. Recipes from a vendor, a drop or a quest you tick off yourself.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function CharacterEditor({ char, onDeleted }: { char: Character; onDeleted: () => void }) {
  const { mutate, recipeRecords } = useStore();
  const save = (patch: Partial<Character>) => mutate((repo) => repo.saveCharacter({ ...char, ...patch, updatedAt: Date.now() }));
  const setProfession = (i: number, patch: Partial<CharacterProfession>) =>
    save({ professions: char.professions.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const [newProf, setNewProf] = useState('');
  const options = professionOptions(recipeRecords.map((r) => r.imported.profession)).filter(
    (p) => !char.professions.some((x) => x.profession.toLowerCase() === p.toLowerCase()),
  );
  const addProfession = () => {
    const profession = newProf.trim();
    if (!profession) return;
    save({ professions: [...char.professions, { profession, skill: 1 }] });
    setNewProf('');
  };

  return (
    <div className="stack">
      <Panel
        title={<input className="title-input" value={char.name} onChange={(e) => save({ name: e.target.value })} aria-label="Character name" />}
        actions={
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Delete character "${char.name}"?`)) {
                mutate((repo) => repo.deleteCharacter(char.id));
                onDeleted();
              }
            }}
          >
            Delete
          </button>
        }
      >
        <div className="field-row">
          <label>
            Realm
            <input value={char.realm} onChange={(e) => save({ realm: e.target.value })} />
          </label>
          <div className="seg-field">
            <span>Faction</span>
            <Segmented
              label="Faction"
              value={char.faction ?? ''}
              options={[
                { value: '', label: 'Unset' },
                { value: 'alliance', label: 'Alliance' },
                { value: 'horde', label: 'Horde' },
              ]}
              onChange={(v) => save({ faction: (v || null) as Faction | null })}
            />
          </div>
          <label>
            Level
            <NumberInput value={char.level} min={1} step={1} onChange={(v) => save({ level: v })} />
          </label>
        </div>
        <textarea className="notes" placeholder="Notes" value={char.notes} onChange={(e) => save({ notes: e.target.value })} rows={2} />

        <h3>Professions</h3>
        <table className="form-table">
          <tbody>
            {char.professions.map((p, i) => (
              <tr key={i}>
                <td>{p.profession}</td>
                <td>
                  <NumberInput value={p.skill} min={0} step={1} onChange={(v) => setProfession(i, { skill: Math.max(0, v ?? 0) })} />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    onClick={() => confirm(`Remove ${p.profession} from ${char.name}?`) && save({ professions: char.professions.filter((_, k) => k !== i) })}
                    aria-label={`Remove ${p.profession}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="add-row">
          <input
            list="character-professions"
            value={newProf}
            placeholder="Profession"
            onChange={(e) => setNewProf(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProfession()}
          />
          <datalist id="character-professions">
            {options.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <button disabled={!newProf.trim()} onClick={addProfession}>
            Add profession
          </button>
        </div>
      </Panel>

      {char.professions.map((p) => (
        <ProfessionRecipes key={p.profession} char={char} prof={p} />
      ))}
    </div>
  );
}

type Show = 'known' | 'learnable' | 'all';

const STATUS_ORDER: Record<RecipeStatus, number> = { known: 0, learnable: 1, 'too-low': 2, unknown: 3 };

function statusText(k: RecipeKnowledge): string {
  switch (k.status) {
    case 'known':
      return k.via === 'learned' ? 'Learned' : 'Trained';
    case 'learnable':
      return 'Can learn';
    case 'too-low':
      return `Needs ${k.recipe.requiredSkill}`;
    case 'unknown':
      return 'No skill data';
  }
}

/** The recipes of one of the character's professions, with what it knows. */
function ProfessionRecipes({ char, prof }: { char: Character; prof: CharacterProfession }) {
  const { engine, mutate } = useStore();
  const [show, setShow] = useState<Show>('known');
  const [search, setSearch] = useState('');
  const all = useMemo(
    () =>
      characterRecipes({ ...char, professions: [prof] }, engine.recipes.values()).sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          (a.recipe.requiredSkill ?? Infinity) - (b.recipe.requiredSkill ?? Infinity) ||
          a.recipe.name.localeCompare(b.recipe.name),
      ),
    [char, prof, engine.recipes],
  );
  const count = (s: RecipeStatus) => all.filter((k) => k.status === s).length;
  const q = search.trim().toLowerCase();
  const rows = all
    .filter((k) => show === 'all' || k.status === show)
    .filter((k) => !q || k.recipe.name.toLowerCase().includes(q));
  // Only recipes the trainer rule cannot tell are ticked by hand.
  const tickable = (k: RecipeKnowledge) => !(k.status === 'known' && k.via === 'trainer');

  return (
    <Panel
      title={
        <>
          {prof.profession} <span className="muted">{prof.skill}</span>
        </>
      }
      actions={
        <span className="small muted">
          {count('known')} known · {count('learnable')} can learn · {count('too-low')} need more skill
          {count('unknown') > 0 && ` · ${count('unknown')} without skill data`}
        </span>
      }
    >
      <div className="table-filters">
        <Segmented
          label="Show"
          value={show}
          options={[
            { value: 'known', label: 'Known' },
            { value: 'learnable', label: 'Can learn' },
            { value: 'all', label: 'All' },
          ]}
          onChange={setShow}
        />
        <input type="search" className="search" placeholder="Search recipe" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search recipes" />
      </div>
      {all.length === 0 ? (
        <p className="small muted">
          No {prof.profession} recipes in the game data yet. Add them on the <a href="#recipes">Recipes</a> page: bulk import a copy of the profession's recipe
          table from Wowhead, which also brings in each recipe's skill levels and source.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="check" title="Learned from a recipe item, quest or drop">
                  Learned
                </th>
                <th>Recipe</th>
                <th>Learned from</th>
                <th className="r">Skill</th>
                <th>Levels</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.recipe.id} className={k.status === 'known' ? '' : 'dim'}>
                  <td className="check">
                    {tickable(k) ? (
                      <input
                        type="checkbox"
                        checked={char.learned.includes(k.recipe.id)}
                        onChange={(e) => mutate((repo) => repo.setLearned(char.id, k.recipe.id, e.target.checked))}
                        aria-label={`${char.name} learned ${k.recipe.name}`}
                      />
                    ) : (
                      <span className="muted small">trainer</span>
                    )}
                  </td>
                  <td>
                    {k.recipe.spellId ? (
                      <a href={wowheadUrl('spell', k.recipe.spellId)} target="_blank" rel="noreferrer">
                        {k.recipe.name}
                      </a>
                    ) : (
                      k.recipe.name
                    )}
                  </td>
                  <td className="small">{k.recipe.learnedFrom.length ? learnedFromText(k.recipe.learnedFrom) : <span className="muted">-</span>}</td>
                  <td className={`r ${k.recipe.skillRange ? `skill-${k.color ?? 'red'}` : ''}`} title="In the color it has at this skill">{k.recipe.requiredSkill ?? <span className="muted">-</span>}</td>
                  <td className="small">{k.recipe.skillRange ? <SkillLevels range={k.recipe.skillRange} /> : <span className="muted">-</span>}</td>
                  <td className="small">{statusText(k)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing to show here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        Missing a recipe? Add it on the <a href="#recipes">Recipes</a> page.
      </p>
    </Panel>
  );
}
