import React, { useState, useEffect } from 'react';
import { CatalogItem } from '../services/catalogService';
import { catalogService } from '../services/catalogService';
// import { seedCatalog } from '../services/seeder'; // Removed legacy seeder
import { ThumbsUp, Download, PenTool, Palette, ArrowLeft, Database, AlertCircle } from 'lucide-react';

interface CatalogPageProps {
  onBack: () => void;
  onImport: (item: CatalogItem) => void;
  userId?: string;
  category: 'style' | 'color';
}

export const CatalogPage: React.FC<CatalogPageProps> = ({
  onBack,
  onImport,
  userId,
  category
}) => {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCatalog();
  }, [category]);

  const loadCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await catalogService.getCatalogItems(category);
      setItems(data);
    } catch (e: any) {
      console.error("Failed to load catalog", e);
      setError("Failed to load catalog items. " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (itemId: string, currentVotes: number, hasVoted: boolean) => {
    if (!userId) return; // Prompt login ideally
    
    // Optimistic update
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const isUp = !hasVoted;
        return {
          ...item,
          votes: item.votes + (isUp ? 1 : -1),
          voters: isUp ? [...item.voters, userId] : item.voters.filter(v => v !== userId)
        };
      }
      return item;
    }));

    try {
      await catalogService.voteItem(category, itemId, userId, hasVoted ? 'down' : 'up');
    } catch (e) {
      console.error("Vote failed", e);
      // Revert on failure (could implement)
    }
  };

// const handleManualSeed = async () => { ... } // Removed legacy manual seed
// Button removed from UI


  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 dark:bg-[#0d1117]">
      {/* Header */}
      <div className="flex justify-between items-center px-6 py-6 border-b border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117]">
        <div className="flex items-center gap-4">
           <button 
             onClick={onBack}
             className="p-2 -ml-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
           >
             <ArrowLeft size={24} />
           </button>
           <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 dark:bg-[#21262d] rounded-lg text-brand-teal">
                 {category === 'style' ? <PenTool size={24} /> : <Palette size={24} />}
              </div>
              <div>
                 <h2 className="text-2xl font-bold capitalize text-slate-900 dark:text-white">Community {category}s</h2>
                 <p className="text-sm text-slate-500">Discover and add {category}s created by the community.</p>
              </div>
           </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-200">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-4 border-brand-teal border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-slate-500 flex flex-col items-center">
            <p className="mb-2">No {category}s found in the catalog yet.</p>
            <p className="text-xs mb-6">Be the first to contribute or populate with defaults.</p>
            <p className="text-[12px] text-slate-400 mt-2 max-w-xs">
              System defaults are seeded automatically for admins.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {items.map(item => (
              <div key={item.id} className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-bold text-base text-slate-900 dark:text-white line-clamp-1">{(item.data as any).name}</h4>
                    <p className="text-xs text-slate-500">by {item.authorName}</p>
                  </div>
                  {item.type === 'color' && (
                    <div className="flex gap-0.5 h-6 w-24 rounded-md overflow-hidden ring-1 ring-black/5">
                      {(item.data as any).colors.map((c: string, i: number) => (
                        <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  )}
                </div>

                {item.type === 'style' && (
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 line-clamp-3 flex-1">
                    {(item.data as any).description}
                  </p>
                )}
                {/* Spacer for other types to align bottom */}
                {item.type !== 'style' && <div className="flex-1"></div>}

                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-[#30363d] mt-auto">
                  <button 
                    onClick={() => handleVote(item.id, item.votes, userId ? item.voters.includes(userId) : false)}
                    disabled={!userId}
                    className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                      userId && item.voters.includes(userId) 
                        ? 'text-brand-teal bg-teal-50 dark:bg-teal-900/20' 
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d]'
                    }`}
                  >
                    <ThumbsUp size={16} />
                    {item.votes}
                  </button>
                  
                  <button 
                    onClick={() => onImport(item)}
                    className="flex items-center gap-2 text-sm font-bold text-white bg-brand-teal hover:bg-teal-600 px-4 py-2 rounded-lg shadow-sm transition-colors"
                  >
                    <Download size={16} /> Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
