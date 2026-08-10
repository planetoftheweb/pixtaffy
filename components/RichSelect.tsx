import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, type LucideIcon } from 'lucide-react';

export interface RichSelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  keywords?: string[];
  icon?: LucideIcon;
}

interface RichSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: RichSelectOption[];
  placeholder?: string;
  subLabel?: string;
  icon?: LucideIcon;
  searchable?: boolean;
  searchPlaceholder?: string;
  groupOrder?: string[];
  expandMenuToContent?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  /**
   * Extra classes applied to the trigger's selected-label/placeholder span.
   * Useful for hiding the label at smaller breakpoints (e.g. `"hidden
   * xl:inline"`) so the trigger collapses to icon + chevron when toolbar
   * real estate is tight, while still showing the text once there's room.
   */
  triggerLabelClassName?: string;
  hideOptionDescriptions?: boolean;
}

export const RichSelect: React.FC<RichSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  subLabel,
  icon: Icon,
  searchable = false,
  searchPlaceholder = 'Search...',
  groupOrder,
  expandMenuToContent = true,
  disabled = false,
  compact = false,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  triggerLabelClassName = '',
  hideOptionDescriptions = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [menuAlign, setMenuAlign] = useState<'left' | 'right'>('left');
  const [menuVerticalAlign, setMenuVerticalAlign] = useState<'down' | 'up'>('down');
  const [menuListMaxHeight, setMenuListMaxHeight] = useState(288);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const evaluateAlignment = () => {
      const menuEl = menuRef.current;
      const containerEl = containerRef.current;
      if (!menuEl || !containerEl) return;
      const rect = menuEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const viewportPadding = 12;
      const spaceBelow = window.innerHeight - containerRect.bottom - viewportPadding;
      const spaceAbove = containerRect.top - viewportPadding;
      const shouldOpenUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      setMenuVerticalAlign(shouldOpenUp ? 'up' : 'down');

      const availableSpace = shouldOpenUp ? spaceAbove : spaceBelow;
      const menuChrome = searchable ? 86 : 18;
      const nextMaxListHeight = Math.max(160, Math.min(420, Math.floor(availableSpace - menuChrome)));
      setMenuListMaxHeight(nextMaxListHeight);

      if (rect.right > window.innerWidth - viewportPadding) {
        setMenuAlign('right');
        return;
      }
      if (rect.left < viewportPadding) {
        setMenuAlign('left');
      }
    };

    const rafId = requestAnimationFrame(evaluateAlignment);
    window.addEventListener('resize', evaluateAlignment);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', evaluateAlignment);
    };
  }, [isOpen, options.length, searchTerm, expandMenuToContent]);

  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value]
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedSearch) return options;
    return options.filter(option => {
      const searchableText = [
        option.label,
        option.description,
        option.group,
        ...(option.keywords || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchableText.includes(normalizedSearch);
    });
  }, [options, normalizedSearch]);

  const groupedOptions = useMemo(() => {
    const buckets = new Map<string, RichSelectOption[]>();
    for (const option of filteredOptions) {
      const key = option.group || '';
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)!.push(option);
    }

    const defaultOrder = Array.from(buckets.keys());
    const ungroupedKey = '';
    if (!groupOrder || groupOrder.length === 0) {
      return defaultOrder.map(key => ({ key, label: key, options: buckets.get(key) || [] }));
    }

    const prioritized = groupOrder.filter(group => buckets.has(group));
    const remaining = defaultOrder.filter(group => group !== ungroupedKey && !groupOrder.includes(group));
    const ordered = [
      ...(buckets.has(ungroupedKey) ? [ungroupedKey] : []),
      ...prioritized,
      ...remaining
    ];
    return ordered.map(key => ({ key, label: key, options: buckets.get(key) || [] }));
  }, [filteredOptions, groupOrder]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  const buttonPadding = compact ? 'py-2 min-h-9' : 'py-2.5 min-h-11';
  const isInteractive = !disabled && options.length > 0;
  const hasToolbarPresentation = Boolean(subLabel || Icon) && !compact;
  const labelText = selectedOption?.label || placeholder;
  const verticalPositionClass = menuVerticalAlign === 'up' ? 'bottom-full mb-2' : 'top-full mt-2';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (!isInteractive) return;
          setIsOpen(prev => !prev);
        }}
        disabled={!isInteractive}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group relative w-full rounded-lg border overflow-hidden transition-all ${buttonPadding} px-3 text-left ${
          isOpen
            ? 'bg-gray-100 dark:bg-[#1c2128] border-brand-teal'
            : 'bg-white dark:bg-[#0d1117] border-gray-200 dark:border-[#30363d]'
        } ${
          isInteractive
            ? 'cursor-pointer hover:border-slate-400 dark:hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-[#161b22]'
            : 'cursor-not-allowed opacity-60'
        } ${buttonClassName}`}
      >
        <span
          className={`pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-teal/12 via-brand-teal/5 to-transparent transition-opacity ${
            isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
        <span className="relative z-10 flex items-center justify-between gap-2.5">
          <span className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <Icon
                size={compact ? 14 : 16}
                className={`shrink-0 ${
                  isOpen
                    ? 'text-brand-teal'
                    : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-400'
                }`}
              />
            )}
            {hasToolbarPresentation ? (
              <span className="flex flex-col min-w-0">
                {subLabel && (
                  <span className="text-[11px] uppercase font-bold text-brand-teal leading-none mb-0.5">
                    {subLabel}
                  </span>
                )}
                <span
                  className={`break-words whitespace-normal leading-tight ${
                    selectedOption
                      ? 'text-brand-teal font-semibold'
                      : 'text-slate-400 dark:text-slate-500 font-medium'
                  } ${compact ? 'text-[13px]' : 'text-[15px]'} ${triggerLabelClassName}`}
                >
                  {labelText}
                </span>
              </span>
            ) : (
              <span
                className={`break-words whitespace-normal leading-tight ${
                  selectedOption
                    ? 'text-slate-900 dark:text-white font-medium'
                    : 'text-slate-400 dark:text-slate-500'
                } ${compact ? 'text-xs' : 'text-sm'} ${triggerLabelClassName}`}
              >
                {labelText}
              </span>
            )}
          </span>
          <ChevronDown
            size={compact ? 13 : 14}
            className={`shrink-0 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-brand-teal' : 'text-slate-500'
            }`}
          />
        </span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className={`absolute ${verticalPositionClass} ${menuAlign === 'right' ? 'right-0' : 'left-0'} z-[120] bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
            expandMenuToContent
              ? 'min-w-full w-max max-w-[min(40rem,calc(100vw-1.5rem))]'
              : 'w-full'
          } ${menuClassName}`}
        >
          {searchable && (
            <div className="p-2 border-b border-gray-200 dark:border-[#30363d] sticky top-0 bg-white dark:bg-[#161b22] z-10">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={searchPlaceholder}
                  autoFocus
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-md focus:outline-none focus:ring-1 focus:ring-brand-teal text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          <div className="overflow-y-auto custom-scrollbar p-1" style={{ maxHeight: menuListMaxHeight }}>
            {groupedOptions.map(group => {
              const hasGroupLabel = Boolean(group.label);
              const optionPaddingLeft = hasGroupLabel ? 'pl-6' : 'pl-3';
              return (
                <div key={group.key || 'ungrouped'} className="mb-1">
                  {hasGroupLabel && (
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-gray-50 dark:bg-[#161b22] sticky top-0 z-[1] border-b border-gray-100 dark:border-[#30363d]">
                      {group.label}
                    </div>
                  )}
                  {group.options.map(option => {
                    const selected = option.value === value;
                    const ItemIcon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleSelect(option.value)}
                        title={hideOptionDescriptions && option.description ? option.description : undefined}
                        className={`w-full text-left ${optionPaddingLeft} pr-3 py-2 rounded-md transition-colors flex items-start justify-between gap-2 ${
                          selected
                            ? 'bg-brand-teal/10 text-brand-teal'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d]'
                        }`}
                      >
                        <span className="min-w-0 flex items-start gap-2.5">
                          {ItemIcon && (
                            <ItemIcon size={14} className={`shrink-0 mt-0.5 ${selected ? 'text-brand-teal' : 'text-slate-500'}`} />
                          )}
                          <span className="min-w-0">
                            <span className={`block break-words whitespace-normal leading-tight ${compact ? 'text-[13px]' : 'text-sm'} ${selected ? 'font-semibold' : 'font-medium'}`}>
                              {option.label}
                            </span>
                            {!hideOptionDescriptions && option.description && (
                              <span className="block whitespace-normal break-words leading-tight text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {option.description}
                              </span>
                            )}
                          </span>
                        </span>
                        {selected && <Check size={14} className="shrink-0 mt-0.5 text-brand-teal" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="p-4 text-center text-xs text-slate-500">
                No options found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
