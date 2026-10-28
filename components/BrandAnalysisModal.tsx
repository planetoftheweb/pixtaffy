import { Tip } from './settings/Tip';
import { FOCUS_RING } from '../utils/focusRing';
import React, { useState } from 'react';
import { X, Check, CheckCircle2, Circle, Palette, PenTool, Layout, Globe, Lock } from 'lucide-react';
import { BrandGuidelinesAnalysis } from '../types';

interface BrandAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisResult: BrandGuidelinesAnalysis | null;
  onConfirm: (selected: BrandGuidelinesAnalysis, scope: 'public' | 'private') => void;
}

export const BrandAnalysisModal: React.FC<BrandAnalysisModalProps> = ({
  isOpen,
  onClose,
  analysisResult,
  onConfirm
}) => {
  if (!isOpen || !analysisResult) return null;

  const [scope, setScope] = useState<'public' | 'private'>('public');

  const [selectedColors, setSelectedColors] = useState<number[]>(
    analysisResult.brandColors.map((_, i) => i) // Default all selected
  );
  const [selectedStyles, setSelectedStyles] = useState<number[]>(
    analysisResult.visualStyles.map((_, i) => i) // Default all selected
  );
  const [selectedTypes, setSelectedTypes] = useState<number[]>(
    analysisResult.graphicTypes.map((_, i) => i) // Default all selected
  );

  const toggleSelection = (index: number, currentSelected: number[], setSelected: React.Dispatch<React.SetStateAction<number[]>>) => {
    if (currentSelected.includes(index)) {
      setSelected(currentSelected.filter(i => i !== index));
    } else {
      setSelected([...currentSelected, index]);
    }
  };

  const handleConfirm = () => {
    onConfirm({
      brandColors: analysisResult.brandColors.filter((_, i) => selectedColors.includes(i)),
      visualStyles: analysisResult.visualStyles.filter((_, i) => selectedStyles.includes(i)),
      graphicTypes: analysisResult.graphicTypes.filter((_, i) => selectedTypes.includes(i))
    }, scope);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-900 dark:text-white animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-[#30363d]">
          <div>
            <h3 className="text-lg font-bold">Review Analyzed Brand Assets</h3>
            <p className="text-xs text-slate-500">Select the items you want to import.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className={`[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#30363d] transition-colors ${FOCUS_RING}`}>
            <X size={20} />
             <Tip text="Close" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* Scope Selection */}
          <div className="bg-gray-50 dark:bg-[#0d1117] p-4 rounded-xl border border-gray-200 dark:border-[#30363d]">
             <h4 className="font-bold text-sm uppercase tracking-wide text-slate-500 mb-3">Import Visibility</h4>
             <div className="flex gap-4">
               <button 
                 onClick={() => setScope('public')}
                 className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all ${
                   scope === 'public' 
                     ? 'bg-white dark:bg-[#161b22] border-brand-teal ring-1 ring-brand-teal shadow-sm' 
                     : 'bg-transparent border-transparent hover:bg-white dark:hover:bg-[#161b22] hover:border-gray-200 dark:hover:border-[#30363d]'
                 } ${FOCUS_RING}`}
               >
                 <div className={`p-2 rounded-full ${scope === 'public' ? 'bg-teal-50 dark:bg-teal-900/20 text-brand-teal' : 'bg-gray-100 dark:bg-[#21262d] text-slate-400'}`}>
                    <Globe size={18} />
                 </div>
                 <div className="text-left">
                    <p className={`text-sm font-bold ${scope === 'public' ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>Public</p>
                    <p className="text-xs text-slate-400">Available to everyone in community</p>
                 </div>
                 {scope === 'public' && <CheckCircle2 size={18} className="ml-auto text-brand-teal" />}
               </button>

               <button 
                 onClick={() => setScope('private')}
                 className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all ${
                   scope === 'private' 
                     ? 'bg-white dark:bg-[#161b22] border-brand-teal ring-1 ring-brand-teal shadow-sm' 
                     : 'bg-transparent border-transparent hover:bg-white dark:hover:bg-[#161b22] hover:border-gray-200 dark:hover:border-[#30363d]'
                 } ${FOCUS_RING}`}
               >
                 <div className={`p-2 rounded-full ${scope === 'private' ? 'bg-teal-50 dark:bg-teal-900/20 text-brand-teal' : 'bg-gray-100 dark:bg-[#21262d] text-slate-400'}`}>
                    <Lock size={18} />
                 </div>
                 <div className="text-left">
                    <p className={`text-sm font-bold ${scope === 'private' ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>Private</p>
                    <p className="text-xs text-slate-400">Only visible to you</p>
                 </div>
                 {scope === 'private' && <CheckCircle2 size={18} className="ml-auto text-brand-teal" />}
               </button>
             </div>
          </div>
          
          {/* Colors Section */}
          {analysisResult.brandColors.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Palette size={18} className="text-brand-red dark:text-brand-orange" />
                <h4 className="font-bold text-sm uppercase tracking-wide text-slate-500">Proposed Color Palettes</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysisResult.brandColors.map((palette, index) => {
                  const isSelected = selectedColors.includes(index);
                  return (
                    <div 
                      key={index}
                      onClick={() => toggleSelection(index, selectedColors, setSelectedColors)}
                      className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex items-center gap-3 ${
                        isSelected 
                          ? 'border-brand-teal bg-teal-50 dark:bg-teal-900/10' 
                          : 'border-gray-100 dark:border-[#30363d] hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className={`shrink-0 ${isSelected ? 'text-brand-teal' : 'text-slate-300'}`}>
                        {isSelected ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{palette.name}</p>
                        <div className="flex h-3 w-full rounded-full overflow-hidden mt-2 ring-1 ring-black/5 dark:ring-white/10">
                          {palette.colors.map((hex, i) => (
                            <div key={i} className="flex-1 h-full" style={{ backgroundColor: hex }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Styles Section */}
          {analysisResult.visualStyles.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <PenTool size={18} className="text-brand-teal" />
                <h4 className="font-bold text-sm uppercase tracking-wide text-slate-500">Proposed Visual Styles</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysisResult.visualStyles.map((style, index) => {
                  const isSelected = selectedStyles.includes(index);
                  return (
                    <div 
                      key={index}
                      onClick={() => toggleSelection(index, selectedStyles, setSelectedStyles)}
                      className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                        isSelected 
                          ? 'border-brand-teal bg-teal-50 dark:bg-teal-900/10' 
                          : 'border-gray-100 dark:border-[#30363d] hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className={`shrink-0 mt-0.5 ${isSelected ? 'text-brand-teal' : 'text-slate-300'}`}>
                        {isSelected ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                      </div>
                      <div>
                        <p className="font-bold text-sm">{style.name}</p>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{style.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

           {/* Types Section */}
           {analysisResult.graphicTypes.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Layout size={18} className="text-blue-500" />
                <h4 className="font-bold text-sm uppercase tracking-wide text-slate-500">Proposed Graphic Types</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {analysisResult.graphicTypes.map((type, index) => {
                  const isSelected = selectedTypes.includes(index);
                  return (
                    <div 
                      key={index}
                      onClick={() => toggleSelection(index, selectedTypes, setSelectedTypes)}
                      className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex items-center gap-3 ${
                        isSelected 
                          ? 'border-brand-teal bg-teal-50 dark:bg-teal-900/10' 
                          : 'border-gray-100 dark:border-[#30363d] hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className={`shrink-0 ${isSelected ? 'text-brand-teal' : 'text-slate-300'}`}>
                        {isSelected ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                      </div>
                      <p className="font-bold text-sm truncate">{type.name}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {analysisResult.brandColors.length === 0 && analysisResult.visualStyles.length === 0 && analysisResult.graphicTypes.length === 0 && (
             <div className="text-center py-10 text-slate-500">
                <p>No brand assets could be extracted from this file.</p>
             </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-[#30363d] flex justify-end gap-3 bg-gray-50 dark:bg-[#0d1117]">
          <button 
            onClick={onClose}
            className={`px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-lg font-medium text-sm transition-colors ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm}
            className={`flex items-center gap-2 px-6 py-2 bg-brand-teal hover:bg-teal-600 text-[#0d1117] rounded-lg font-medium transition-colors text-sm shadow-lg shadow-brand-teal/20 ${FOCUS_RING}`}
          >
            <Check size={16} /> 
            Import Selected ({selectedColors.length + selectedStyles.length + selectedTypes.length})
          </button>
        </div>

      </div>
    </div>
  );
};

