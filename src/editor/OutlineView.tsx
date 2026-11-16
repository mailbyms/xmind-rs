import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Topic } from '../lib/types';

interface Props {
  root: Topic;
  selected: string | null;
  zoom: number;
  onSelect: (id: string) => void;
  onAction: (cmd: string, args?: Record<string, unknown>) => void;
}

interface Row {
  topic: Topic;
  depth: number;
}

/** Flattens the attached branches the way XMind's outliner does: folded
 *  topics keep their children out of the flow. */
function flatten(root: Topic): Row[] {
  const rows: Row[] = [];
  const walk = (topic: Topic, depth: number) => {
    for (const child of topic.children ?? []) {
      rows.push({ topic: child, depth });
      if (!child.folded) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

function countTopics(topic: Topic): number {
  let total = 0;
  for (const list of [topic.children, topic.detached, topic.summary, topic.callout]) {
    for (const child of list ?? []) total += 1 + countTopics(child);
  }
  return total;
}

/** XMind's outliner: a 650px centred column, 40px title, 22px indent steps. */
export default function OutlineView({ root, selected, zoom, onSelect, onAction }: Props) {
  const rows = useMemo(() => flatten(root), [root]);
  const [editing, setEditing] = useState<string | null>(null);
  const draft = useRef('');

  const beginEdit = useCallback((topic: Topic, element: HTMLElement) => {
    draft.current = topic.title;
    setEditing(topic.id);
    element.setAttribute('contenteditable', 'true');
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const endEdit = useCallback((topic: Topic, element: HTMLElement) => {
    element.removeAttribute('contenteditable');
    setEditing(null);
    const title = (element.textContent ?? '').trim();
    if (title && title !== topic.title) onAction('rename', { id: topic.id, title });
    else element.textContent = topic.title;
  }, [onAction]);

  const marker = (topic: Topic) => {
    if ((topic.children?.length ?? 0) === 0) return <span className="ol-leaf" />;
    return <span className={`ol-caret${topic.folded ? '' : ' open'}`} />;
  };

  return (
    <div className="outline-view">
      <div className="ol-scroll">
        <div className="ol-inner" style={{ zoom: zoom / 100 }}>
          <div className="ol-central">
            <span
              className={`ol-central-title${selected === root.id ? ' sel' : ''}`}
              onClick={() => onSelect(root.id)}
            >{root.title}</span>
          </div>

          <div className="ol-list">
            {rows.map(({ topic, depth }) => {
              const folded = topic.folded && (topic.children?.length ?? 0) > 0;
              return (
                <div
                  key={topic.id}
                  className={`ol-row${selected === topic.id ? ' sel' : ''}${depth === 0 ? ' main' : ''}`}
                  style={{ paddingLeft: 20 + depth * 22, '--pl': `${20 + depth * 22}px` } as CSSProperties}
                  onPointerDown={() => onSelect(topic.id)}
                >
                  <span
                    className={`ol-dot${(topic.children?.length ?? 0) > 0 ? ' toggle' : ''}`}
                    title={(topic.children?.length ?? 0) > 0 ? (topic.folded ? '展开' : '折叠') : undefined}
                    onClick={(event) => {
                      // The whole 18px handle toggles, like the shipped outliner.
                      if ((topic.children?.length ?? 0) === 0) return;
                      event.stopPropagation();
                      onAction('toggleFold', { id: topic.id });
                    }}
                  >{marker(topic)}</span>
                  <span
                    className={`ol-title d${Math.min(depth, 3)}`}
                    data-editing={editing === topic.id ? 'true' : undefined}
                    onDoubleClick={(event) => beginEdit(topic, event.currentTarget)}
                    onBlur={(event) => {
                      if (editing === topic.id) endEdit(topic, event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                      if (event.key === 'Escape') { event.currentTarget.textContent = topic.title; event.currentTarget.blur(); }
                    }}
                  >{topic.title}</span>
                  {folded && <span className="ol-badge">{countTopics(topic)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
