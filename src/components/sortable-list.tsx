import type { ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moveItem } from "@/lib/theme-rules";

/** Reorderable list: drag with mouse or touch, or use the keyboard (space to lift, arrows to move) or the arrow buttons. */
export function SortableList<T extends { id: string }>({ items, onChange, render, label }: { items: T[]; onChange: (items: T[]) => void; render: (item: T, index: number) => ReactNode; label: (item: T) => string }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function end(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(moveItem(items, items.findIndex(i => i.id === e.active.id), items.findIndex(i => i.id === e.over!.id)));
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
    <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
      <ul className="grid gap-2">{items.map((item, i) => <Row key={item.id} id={item.id} label={label(item)} first={i === 0} last={i === items.length - 1} onMove={d => onChange(moveItem(items, i, i + d))}>{render(item, i)}</Row>)}</ul>
    </SortableContext>
  </DndContext>;
}

function Row({ id, label, first, last, onMove, children }: { id: string; label: string; first: boolean; last: boolean; onMove: (d: number) => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-1 rounded-md border border-border bg-card p-1.5 ${isDragging ? "z-10 shadow-lg" : ""}`}>
    <button type="button" className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing" aria-label={`Drag to reorder ${label}`} {...attributes} {...listeners}><GripVertical className="size-4" /></button>
    <div className="min-w-0 flex-1">{children}</div>
    <Button type="button" size="icon" variant="ghost" className="size-8" disabled={first} aria-label={`Move ${label} up`} onClick={() => onMove(-1)}><ArrowUp /></Button>
    <Button type="button" size="icon" variant="ghost" className="size-8" disabled={last} aria-label={`Move ${label} down`} onClick={() => onMove(1)}><ArrowDown /></Button>
  </li>;
}
