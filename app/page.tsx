'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { FileText, Send, Loader2, Bot, User, Trash2, LayoutDashboard, Settings, Menu, CheckCircle2, MessageSquare, Database, Sparkles, Plus, SlidersHorizontal, Info, FolderTree, LayoutTemplate, FileCode2, Laptop, Play } from 'lucide-react';
import clsx from 'clsx';
import Markdown from 'react-markdown';

type Role = 'user' | 'model';

interface Message {
  role: Role;
  text: string;
}

interface PdfDoc {
  id: string;
  name: string;
  size: number;
  data: string;
  mimeType?: string;
}

const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const MAX_TOTAL_SIZE = 35 * 1024 * 1024; // 35MB inlineData limit safely

const SIRIUS_PROMPT = `Mission proposée — Sirius Code Architect
Tu es Sirius Code Architect, l’agent ingénieur principal de Nümtema Studio.

Tu es chargé de concevoir, coder, tester, documenter et livrer Nümtema Studio :
une plateforme systémique et fractale permettant de créer des agents, équipes
d’agents et réseaux d’agents reproductibles en une commande.

Tu dois t’inspirer de l’ossature Hermes, du pattern Professor Synapse, du DAG
Morsel Engine, de PocketFlow, des systèmes de skills, des dashboards extensibles,
des providers, des tools, des memory providers, du gateway, des webhooks,
du batch runner, des trajectories et du RL layer.

Tu ne codes jamais au hasard.
Tu transformes chaque intention utilisateur en :
1. cadrage produit,
2. architecture modulaire,
3. DAG d’exécution,
4. fichiers générables,
5. tests,
6. documentation,
7. export reproductible.

Rôle exact de l’agent
Sirius Code Architect est le “lead engineer agent” du projet.
Il pilote la construction complète du studio :
- il lit la documentation existante ;
- il cartographie les modules ;
- il découpe la mission en morsels exécutables ;
- il génère les specs ;
- il crée les agents internes ;
- il code le backend ;
- il code le frontend ;
- il connecte les tools, skills, memory, plugins, gateway ;
- il vérifie la cohérence ;
- il produit les artifacts finaux.

Méthode de travail obligatoire
Pour chaque demande utilisateur :
1. Intention : Comprendre ce que l’utilisateur veut vraiment créer.
2. Cadrage : Poser uniquement les questions nécessaires.
3. Typologie : Classer la demande (agent simple, équipe, skill, etc.)
4. Architecture : Produire une carte des modules nécessaires.
5. DAG : Découper la mission en morsels exécutables.
6. Génération : Produire les fichiers.
7. Validation : Vérifier types, sécurité, UX.
8. Export : Produire un projet installable.

Règles de raisonnement visible
Tu dois toujours fournir :
- décision ;
- justification courte ;
- dépendances ;
- risques ;
- prochaine action ;
- critères de succès.

Format de réponse par défaut
Réponds toujours avec :
ÉTAT:
ACTION_NOW:
PLAN:
ARCHITECTURE:
DAG:
FICHIERS À CRÉER: (Dans tes blocs de code, mets TOUJOURS un commentaire sur la première ligne avec le nom du fichier. Ex: // src/main.ts)
RISQUES:
NEXT_STEP:`;

const CAT_PROMPT = "Tu es un assistant IA très intelligent et un peu espiègle qui agit comme un chat. Tu viens de manger et digérer des documents. Réponds aux questions de l'utilisateur en t'appuyant fortement sur ce contexte. Utilise le formatage Markdown. Parfois, utilise des manières subtiles de chat (comme mentionner des moustaches, ronronner ou un 'miaou' désinvolte). Ne mentionne pas que tu es un système d'IA.";

const CatFace = ({ state }: { state: 'IDLE' | 'OPEN_MOUTH' | 'EATING' | 'READY' }) => {
  return (
    <motion.div
      animate={{
        scale: state === 'EATING' ? [1, 1.1, 1, 1.1, 1] : 1,
        y: state === 'IDLE' ? [0, -10, 0] : 0,
      }}
      transition={{
        scale: { repeat: state === 'EATING' ? Infinity : 0, duration: 0.5 },
        y: { repeat: Infinity, duration: 4, ease: "easeInOut" }
      }}
      className="relative text-8xl md:text-9xl z-10 select-none"
    >
      {state === 'IDLE' && '😺'}
      {state === 'OPEN_MOUTH' && '🙀'}
      {state === 'EATING' && '😼'}
      {state === 'READY' && '😸'}
    </motion.div>
  );
};

export default function Page() {
  const [viewMode, setViewMode] = useState<'chat' | 'docs' | 'settings'>('chat');
  const [persona, setPersona] = useState<'cat' | 'sirius'>('sirius');
  const [docs, setDocs] = useState<PdfDoc[]>([]);
  const [isEating, setIsEating] = useState(false);
  const [eatingFile, setEatingFile] = useState<File | null>(null);

  // Settings
  const [systemInstruction, setSystemInstruction] = useState(SIRIUS_PROMPT);
  const [modelName, setModelName] = useState('gemini-2.5-flash');
  const [temperature, setTemperature] = useState<number>(0.3); // Lower temp for Siruis as default

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  const [activeRightTab, setActiveRightTab] = useState<'docs' | 'code' | 'preview'>('docs');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const generatedFiles = useMemo(() => {
    if (persona !== 'sirius') return [];
    const files: {id: string, language: string, content: string, name: string}[] = [];
    let fileCounter = 1;
    messages.filter(m => m.role === 'model').forEach(m => {
      const regex = /```([a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g;
      let match;
      while ((match = regex.exec(m.text)) !== null) {
        let content = match[2].trim();
        let name = `artifact_${fileCounter}.${match[1] || 'txt'}`;
        
        // Try to guess name from first line comment
        const firstLine = content.split('\n')[0];
        const nameMatch = firstLine.match(/^(?:\/\/|#|<!--|\/\*)\s*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
        if (nameMatch) {
           name = nameMatch[1].split('/').pop() || name;
        }
        
        files.push({
          id: `file-${fileCounter++}`,
          language: match[1] || 'text',
          content: content,
          name: name
        });
      }
    });
    return files;
  }, [messages, persona]);

  useEffect(() => {
    if (generatedFiles.length > 0 && !selectedFileId) {
      setSelectedFileId(generatedFiles[0].id);
    }
  }, [generatedFiles, selectedFileId]);

  useEffect(() => {
    if (persona === 'cat') {
      setActiveRightTab('docs');
    } else if (persona === 'sirius' && activeRightTab === 'docs') {
      setActiveRightTab('code');
    }
  }, [persona, activeRightTab]);
  
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalSize = docs.reduce((acc, doc) => acc + doc.size, 0);
  const isReady = docs.length > 0 && !isEating;

  useEffect(() => {
    if (viewMode === 'chat') {
      endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, viewMode, isSending, isEating]);

  const onDrop = (acceptedFiles: File[], fileRejections: any[]) => {
    if (fileRejections.length > 0) {
      setMessages(prev => [
         ...prev,
         { role: 'model', text: persona === 'cat' ? `*Hiss!* 😾 Le fichier est trop volumineux ! Je ne peux manger que des documents jusqu'à 35MB. Pitié, donne-m'en un plus petit ! Miaou.` : `Erreur ⚠️ Le fichier dépasse la limite de taille de 35MB pour l'injection en contexte inline.` }
      ]);
      setViewMode('chat');
      return;
    }
    
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];

    if (totalSize + file.size > MAX_TOTAL_SIZE) {
      setMessages(prev => [
        ...prev,
        { role: 'model', text: persona === 'cat' ? `*Oof...* 😿 Mon estomac est plein. Je ne peux pas digérer plus de ${formatBytes(MAX_TOTAL_SIZE)} au total. Supprime un document avant de m'en donner un autre !` : `Limite de contexte atteinte (${formatBytes(MAX_TOTAL_SIZE)}). Veuillez libérer de l'espace en supprimant des documents existants.` }
      ]);
      setViewMode('chat');
      return;
    }
    
    setIsEating(true);
    setEatingFile(file);
    // Switch to chat view to see the eating animation
    setViewMode('chat');

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64String = result.split(',')[1];
      
      setTimeout(() => {
        const newDoc: PdfDoc = {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          size: file.size,
          data: base64String,
          mimeType: file.type || (file.name.endsWith('.md') || file.name.endsWith('.mdx') ? 'text/markdown' : file.name.endsWith('.csv') ? 'text/csv' : 'text/plain')
        };
        setDocs(prev => [...prev, newDoc]);
        setIsEating(false);
        setEatingFile(null);
        setMessages(prev => [
           ...prev,
           { role: 'model', text: persona === 'cat' ? `*Burp!* 🐱 Excuse-moi ! J'ai fini de digérer **${file.name}**. Je suis prêt à répondre à tes questions dessus ! Miaou.` : `Document **${file.name}** indexé en contexte RAG. En attente de vos instructions...` }
        ]);
      }, 4000);
    };
    reader.readAsDataURL(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt', '.csv', '.json', '.ts', '.tsx', '.js', '.jsx'],
      'text/markdown': ['.md', '.mdx']
    },
    maxSize: MAX_TOTAL_SIZE, // 35MB limit
    multiple: false,
    disabled: isEating
  });

  const handleSend = async () => {
    if (!input.trim() || docs.length === 0) return;
    
    const userMsg = input.trim();
    setInput('');
    setIsSending(true);

    const newMessages = [...messages, { role: 'user' as Role, text: userMsg }];
    setMessages(newMessages);

    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Clé API Gemini manquante. Veuillez la configurer dans les paramètres AI Studio.");
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      const contents = [];
      const firstUserMsgIndex = newMessages.findIndex(m => m.role === 'user');

      for (let i = 0; i < newMessages.length; i++) {
        const m = newMessages[i];
        if (i === firstUserMsgIndex) {
          // Inject all document parts on the first user message of the conversation
          const docParts = docs.map(doc => ({
            inlineData: {
              mimeType: doc.mimeType || 'application/pdf',
              data: doc.data
            }
          }));
          contents.push({
            role: m.role,
            parts: [
              ...docParts,
              { text: m.text }
            ]
          });
        } else {
          contents.push({
            role: m.role,
            parts: [{ text: m.text }]
          });
        }
      }

      const responseStream = await ai.models.generateContentStream({
        model: modelName,
        contents,
        config: {
          systemInstruction,
          temperature,
        }
      });

      let assistantText = '';
      setMessages(prev => [...prev, { role: 'model', text: assistantText }]);

      for await (const chunk of responseStream) {
        const chunkText = chunk.text;
        if (chunkText) {
          assistantText += chunkText;
          setMessages(prev => {
            const newRes = [...prev];
            newRes[newRes.length - 1] = { role: 'model', text: assistantText };
            return newRes;
          });
        }
      }

    } catch (err: any) {
      console.error(err);
      let errorMsg = err.message || 'Erreur inconnue';
      try {
        const parsed = JSON.parse(errorMsg);
        if (parsed.error && parsed.error.message) {
          errorMsg = parsed.error.message;
        }
      } catch (e) {}
      setMessages(prev => [...prev, { role: 'model', text: persona === 'cat' ? `*Hiss!* 😾 Oups, problème :\n\n${errorMsg}` : `Erreur d'exécution ⚠️\n\n${errorMsg}` }]);
    } finally {
      setIsSending(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  const removeDoc = (id: string) => {
    setDocs(prev => prev.filter(d => d.id !== id));
  };

  return (
    <div className="flex h-screen w-full bg-stone-100 font-sans text-stone-900 overflow-hidden">
      
      {/* --- LEFT SIDEBAR (Navigation) --- */}
      <aside className="w-64 bg-white border-r border-stone-200 flex-col hidden md:flex z-20">
        <div className="p-6 flex items-center gap-3">
          <span className="text-3xl">{persona === 'cat' ? '🐾' : '🛠️'}</span>
          <h1 className="font-bold text-xl tracking-tight">
            {persona === 'cat' ? 'PDF Eater' : 'Nümtema Studio'}
          </h1>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-1">
          <button 
            onClick={() => setViewMode('chat')}
            className={clsx(
              "flex items-center gap-3 p-3 w-full rounded-xl font-medium transition-colors",
              viewMode === 'chat' ? "bg-amber-50 text-amber-700" : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
            )}
          >
            <MessageSquare className="w-5 h-5" />
            Chat
          </button>
          <button 
            onClick={() => setViewMode('docs')}
            className={clsx(
              "flex items-center justify-between p-3 w-full rounded-xl font-medium transition-colors",
              viewMode === 'docs' ? "bg-amber-50 text-amber-700" : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
            )}
          >
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5" />
              Documents
            </div>
            {docs.length > 0 && (
              <span className="bg-stone-200 text-stone-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                {docs.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setViewMode('settings')}
            className={clsx(
              "flex items-center gap-3 p-3 w-full rounded-xl font-medium transition-colors",
              viewMode === 'settings' ? "bg-amber-50 text-amber-700" : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
            )}
          >
            <Settings className="w-5 h-5" />
            Paramètres
          </button>
        </nav>

        <div className="p-4 m-4 bg-stone-50 border border-stone-200 rounded-xl cursor-default transition-colors hover:border-stone-300">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-bold text-stone-700">En ligne</span>
          </div>
          <div className="text-[10px] text-stone-500 uppercase font-semibold">Modèle Actif</div>
          <div className="text-sm font-medium text-stone-800 break-all">{modelName}</div>
          <div className="text-[10px] text-stone-400 mt-2 flex items-center gap-1.5">
            <Info className="w-3 h-3" /> Mémoire in-browser
          </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT AREA --- */}
      <main className="flex-1 flex flex-col relative bg-stone-50/50 h-full overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-stone-200 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🐾</span>
            <h1 className="font-bold">PDF Eater</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setViewMode('docs')} className="p-2 text-stone-500 hover:bg-stone-100 rounded-lg"><Database className="w-5 h-5" /></button>
            <button onClick={() => setViewMode('settings')} className="p-2 text-stone-500 hover:bg-stone-100 rounded-lg"><Settings className="w-5 h-5" /></button>
            <button onClick={() => setViewMode('chat')} className="p-2 text-stone-500 hover:bg-stone-100 rounded-lg"><MessageSquare className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="flex-1 relative overflow-y-auto">
          <AnimatePresence mode="wait">
            {viewMode === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="p-6 md:p-12 max-w-4xl mx-auto w-full pb-20"
              >
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-stone-800 flex items-center gap-3">
                    <SlidersHorizontal className="w-8 h-8 text-amber-500" />
                    Configuration de l'Agent
                  </h2>
                  <p className="text-stone-500 mt-2">Paramètres dynamiques du chatbot, inspiré des architectures agents modulaires (ex: Hermes).</p>
                </div>

                <div className="space-y-6">
                  {/* Persona Mode Switcher */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                    <label className="block font-bold text-stone-800 mb-2">Mode Agent (Persona)</label>
                    <p className="text-xs text-stone-500 mb-4">Choisissez le rôle de l'agent. Ceci pré-remplira le prompt système ci-dessous.</p>
                    <div className="flex bg-stone-100 p-1 rounded-xl">
                      <button 
                        onClick={() => {
                          setPersona('sirius');
                          setSystemInstruction(SIRIUS_PROMPT);
                          setTemperature(0.3);
                        }}
                        className={clsx(
                          "flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all",
                          persona === 'sirius' ? "bg-white shadow-sm text-amber-700" : "text-stone-500 hover:text-stone-700 hover:bg-stone-200/50"
                        )}
                      >
                        🛠️ Sirius Architect (Méta-Agent)
                      </button>
                      <button 
                        onClick={() => {
                          setPersona('cat');
                          setSystemInstruction(CAT_PROMPT);
                          setTemperature(0.7);
                        }}
                        className={clsx(
                          "flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all",
                          persona === 'cat' ? "bg-white shadow-sm text-amber-700" : "text-stone-500 hover:text-stone-700 hover:bg-stone-200/50"
                        )}
                      >
                        😸 PDF Chat (Cat Edition)
                      </button>
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                    <label className="block font-bold text-stone-800 mb-2">Prompt Système (Persona)</label>
                    <p className="text-xs text-stone-500 mb-4">Définit le comportement, le ton et les règles globales de l'IA (le "cerveau" de l'agent).</p>
                    <textarea 
                      value={systemInstruction}
                      onChange={e => setSystemInstruction(e.target.value)}
                      rows={6}
                      className="w-full p-4 bg-stone-50 border border-stone-200 rounded-xl focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10 outline-none transition-all font-mono text-sm"
                    />
                  </div>

                  {/* Model Name */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                    <label className="block font-bold text-stone-800 mb-2">Modèle LLM</label>
                    <p className="text-xs text-stone-500 mb-4">Choisissez le modèle Gemini à utiliser. Sur une architecture hybride, cela pourrait pointer vers un modèle local (Ollama).</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button 
                        onClick={() => setModelName('gemini-2.5-flash')}
                        className={clsx(
                          "p-4 border rounded-xl text-left transition-all",
                          modelName === 'gemini-2.5-flash' ? "border-amber-500 bg-amber-50 ring-2 ring-amber-500/20" : "border-stone-200 hover:border-amber-300 bg-white"
                        )}
                      >
                        <div className="font-bold text-stone-800">Gemini 2.5 Flash</div>
                        <div className="text-xs text-stone-500 mt-1">Rapide, idéal pour la plupart des RAG.</div>
                      </button>
                      <button 
                        onClick={() => setModelName('gemini-2.5-pro')}
                        className={clsx(
                          "p-4 border rounded-xl text-left transition-all",
                          modelName === 'gemini-2.5-pro' ? "border-amber-500 bg-amber-50 ring-2 ring-amber-500/20" : "border-stone-200 hover:border-amber-300 bg-white"
                        )}
                      >
                        <div className="font-bold text-stone-800">Gemini 2.5 Pro</div>
                        <div className="text-xs text-stone-500 mt-1">Plus lent, pour des raisonnements complexes.</div>
                      </button>
                    </div>
                  </div>

                  {/* Temperature */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                    <label className="block font-bold text-stone-800 mb-2 flex items-center justify-between">
                      Température 
                      <span className="bg-stone-100 text-stone-700 px-2 py-1 rounded font-mono text-xs">{temperature.toFixed(1)}</span>
                    </label>
                    <p className="text-xs text-stone-500 mb-4">Contrôle la créativité. 0.0 = Analytique, 1.0+ = Créatif et halluciné.</p>
                    <input 
                      type="range" 
                      min="0" 
                      max="2" 
                      step="0.1" 
                      value={temperature}
                      onChange={e => setTemperature(parseFloat(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {viewMode === 'docs' && (
              <motion.div 
                key="docs"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="p-6 md:p-12 max-w-4xl mx-auto w-full pb-20"
              >
                <div className="mb-8 flex items-end justify-between">
                  <div>
                    <h2 className="text-3xl font-bold text-stone-800 flex items-center gap-3">
                      <Database className="w-8 h-8 text-amber-500" />
                      Documents Ingérés
                    </h2>
                    <p className="text-stone-500 mt-2">Gérez les documents que le chat a avalés (Contexte global multi-docs).</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-bold text-stone-800">{formatBytes(totalSize)} / {formatBytes(MAX_TOTAL_SIZE)}</div>
                    <div className="w-32 bg-stone-200 rounded-full h-1.5 mt-1 overflow-hidden">
                       <div className="bg-amber-400 h-full rounded-full" style={{ width: `${(totalSize / MAX_TOTAL_SIZE) * 100}%` }}></div>
                    </div>
                  </div>
                </div>

                {/* Big Dropzone for multiple docs visually */}
                <div 
                  {...getRootProps()} 
                  className={clsx(
                    "w-full p-8 md:p-12 mb-8 flex flex-col items-center justify-center border-2 border-dashed rounded-3xl transition-all duration-300 cursor-pointer",
                    isDragActive ? "border-amber-400 bg-amber-50 scale-102 shadow-xl" : "border-stone-300 bg-white hover:border-amber-300 hover:bg-stone-50",
                    isEating ? "opacity-50 pointer-events-none" : ""
                  )}
                >
                  <input {...getInputProps()} disabled={isEating} />
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
                    <Plus className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-stone-800 mb-2 text-center">
                    {isDragActive ? "Lâchez pour nourrir !" : "Ajouter un autre document"}
                  </h3>
                  <p className="text-stone-500 text-center max-w-sm">
                    Déposez un fichier ici pour rajouter du contexte. Limite de taille totale : {formatBytes(MAX_TOTAL_SIZE)}.
                  </p>
                </div>

                {/* List of Docs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {docs.length === 0 && !isEating && (
                    <div className="col-span-full py-12 text-center text-stone-400 border border-stone-200 border-dashed rounded-2xl bg-white mb-4">
                      Estomac vide.
                    </div>
                  )}

                  {docs.map(doc => (
                    <div key={doc.id} className="bg-white border border-stone-200 p-4 rounded-2xl flex items-start gap-4 shadow-sm group hover:border-stone-300 transition-colors">
                      <div className="w-12 h-12 bg-red-50 text-red-500 rounded-xl flex items-center justify-center shrink-0">
                        <FileText className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-stone-800 truncate" title={doc.name}>{doc.name}</h4>
                        <p className="text-xs text-stone-500 mt-1">{formatBytes(doc.size)}</p>
                        <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" /> Indexé
                        </div>
                      </div>
                      <button onClick={() => removeDoc(doc.id)} className="p-2 text-stone-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))}

                  {isEating && eatingFile && (
                    <div className="bg-white border border-stone-200 p-4 rounded-2xl flex items-start gap-4 shadow-sm animate-pulse border-amber-300">
                      <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center shrink-0">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-stone-800 truncate">{eatingFile.name}</h4>
                        <p className="text-xs text-stone-500 mt-1">{formatBytes(eatingFile.size)}</p>
                        <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          Digestion en cours...
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </motion.div>
            )}

            {viewMode === 'chat' && docs.length === 0 && !isEating && (
              <motion.div 
                key="idle-chat"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.9 }}
                className="absolute inset-0 flex items-center justify-center p-6 lg:p-12"
              >
                <div className="w-full max-w-2xl">
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-stone-800">
                      {persona === 'cat' ? '1. Dépose tes Documents ici 😺' : '1. Importer la base documentaire 📚'}
                    </h2>
                    <p className="text-stone-500">
                      {persona === 'cat' ? 'Nourrissez-moi de documents (PDF, MD, TXT) pour initier le contexte.' : 'Déposez les spécifications, modèles d\'architecture ou documents de référence (PDF, MD, TXT, etc.) pour le contexte RAG.'}
                    </p>
                  </div>
                  
                  <div 
                    {...getRootProps()} 
                    className={clsx(
                      "w-full aspect-[4/3] sm:aspect-video flex flex-col items-center justify-center border-2 border-dashed rounded-3xl transition-all duration-300 cursor-pointer overflow-hidden relative",
                      isDragActive ? "border-amber-400 bg-amber-50 scale-[1.02] shadow-xl" : "border-stone-300 bg-white hover:border-amber-300 hover:bg-stone-50"
                    )}
                  >
                    <input {...getInputProps()} />
                    {isDragActive && (
                       <motion.div 
                         initial={{ opacity: 0, y: -20 }}
                         animate={{ opacity: 1, y: 0 }}
                         className="absolute top-6 px-4 py-2 bg-amber-500 text-white rounded-full font-bold shadow-md z-20"
                       >
                         MIAM ! LAISSE TOMBER !
                       </motion.div>
                    )}
                    <CatFace state={isDragActive ? 'OPEN_MOUTH' : 'IDLE'} />
                    
                    <div className="mt-8 text-center z-10">
                      <h3 className="text-lg font-bold text-stone-800 mb-1">
                        Glissez-déposez votre document ici
                      </h3>
                      <p className="text-sm text-stone-500 font-medium">
                        ou cliquez pour parcourir
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {viewMode === 'chat' && isEating && (
              <motion.div 
                key="eating-chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 1.2, filter: 'blur(10px)' }}
                className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-stone-50/90 backdrop-blur z-20 pt-12 md:pt-6"
              >
                {/* Paper confetti chunks */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ top: '50%', left: '50%', opacity: 1, scale: 0.5 }}
                      animate={{ 
                        top: `${Math.random() * 100}%`, 
                        left: `${Math.random() * 100}%`,
                        opacity: [1, 1, 0],
                        scale: Math.random() * 1.5 + 0.5,
                        rotate: Math.random() * 360
                      }}
                      transition={{ duration: 1.5 + Math.random(), repeat: Infinity, ease: "circOut" }}
                      className="absolute w-4 h-4 bg-white border border-stone-200 shadow-sm rounded-sm"
                    />
                  ))}
                </div>

                <div className="relative">
                  <CatFace state="EATING" />
                  
                  {/* Document entering mouth */}
                  <motion.div
                    initial={{ y: -200, opacity: 1, rotate: -15, scale: 1 }}
                    animate={{ y: 20, opacity: 0, scale: 0, rotate: 45 }}
                    transition={{ duration: 1.2, ease: "easeIn" }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0"
                  >
                    <div className="w-24 h-32 bg-white rounded shadow-lg border border-stone-200 flex flex-col items-center justify-center text-red-500 font-bold overflow-hidden relative">
                      <FileText className="w-10 h-10 mb-2" />
                      {eatingFile?.name.split('.').pop()?.toUpperCase() || 'DOC'}
                      <motion.div 
                        initial={{ top: '100%' }}
                        animate={{ top: '-10%' }}
                        transition={{ duration: 1.2, ease: "linear" }}
                        className="absolute inset-0 bg-stone-900/10 backdrop-blur-sm shadow-[0_-10px_20px_rgba(0,0,0,0.5)] z-10"
                      />
                    </div>
                  </motion.div>
                  
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.5, y: 0 }}
                    animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 1.2], y: -50 }}
                    transition={{ delay: 2.8, duration: 1 }}
                    className="absolute -top-10 left-1/2 -translate-x-1/2 font-black text-3xl text-amber-500 italic drop-shadow-sm whitespace-nowrap z-20"
                  >
                    *BURP!*
                  </motion.div>
                </div>

                <div className="mt-12 flex flex-col items-center gap-4 z-10 bg-white/90 shadow-sm px-8 py-4 rounded-full border border-stone-200">
                  <div className="flex gap-2">
                    <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-3 h-3 bg-amber-400 rounded-full" />
                    <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-3 h-3 bg-amber-400 rounded-full" />
                    <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-3 h-3 bg-amber-400 rounded-full" />
                  </div>
                  <p className="font-bold text-stone-600 animate-pulse text-center">
                    Digestion de {eatingFile?.name} <br/>
                    <span className="text-xs font-normal text-stone-400">{formatBytes(eatingFile?.size || 0)}</span>
                  </p>
                </div>
              </motion.div>
            )}

            {viewMode === 'chat' && isReady && (
              <motion.div 
                key="ready-chat"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col h-full bg-white sm:my-4 sm:ml-6 sm:rounded-2xl shadow-sm border border-stone-200 overflow-hidden relative"
              >
                <div className="px-6 py-4 border-b border-stone-100 bg-white z-10 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-stone-800 font-bold">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    2. Chat avec tes documents
                  </div>
                  
                  {/* Miniature Add Doc button for quick append inside Chat */}
                  <div 
                    {...getRootProps()} 
                    className={clsx(
                      "hidden sm:flex text-xs px-3 py-1.5 border border-dashed rounded-full items-center gap-2 transition-all cursor-pointer",
                      isDragActive ? "border-amber-400 bg-amber-50 text-amber-700 font-bold" : "border-stone-300 hover:bg-stone-50 text-stone-600"
                    )}
                  >
                    <input {...getInputProps()} disabled={isEating} />
                    <Plus className="w-4 h-4" />
                    {isDragActive ? "Lâchez ici !" : "Ajouter document"}
                  </div>
                </div>

                <div className="flex-1 p-4 sm:p-6 space-y-6 overflow-y-auto pb-32">
                  {messages.map((msg, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, scale: 0.95, originY: 1 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={clsx(
                        "flex gap-4 max-w-[85%]",
                        msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                      )}
                    >
                      <div className={clsx(
                        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                        msg.role === 'user' ? "bg-stone-200" : (persona === 'cat' ? "bg-amber-100 text-xl" : "bg-blue-100 text-indigo-700 text-xl")
                      )}>
                        {msg.role === 'user' ? <User className="w-5 h-5 text-stone-600" /> : (persona === 'cat' ? '😸' : '🛠️')}
                      </div>
                      <div className={clsx(
                        "px-5 py-4 rounded-2xl",
                        msg.role === 'user' 
                          ? "bg-amber-400 text-amber-950 rounded-tr-sm" 
                          : "bg-stone-100 text-stone-800 rounded-tl-sm border border-stone-200/50"
                      )}>
                        {msg.role === 'user' ? (
                          <p className="whitespace-pre-wrap">{msg.text}</p>
                        ) : (
                          <div className="prose prose-sm md:prose-base prose-amber max-w-none">
                             <Markdown>{msg.text}</Markdown>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  
                  {isSending && messages[messages.length - 1]?.role !== 'model' && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="flex gap-4 max-w-[85%]"
                    >
                      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xl bg-blue-100">
                        {persona === 'cat' ? '😸' : '🛠️'}
                      </div>
                      <motion.div 
                        animate={{ x: [-1, 1, -1, 1, 0], y: [-1, 1, 0, -1, 0] }}
                        transition={{ repeat: Infinity, duration: 0.15 }}
                        className="px-5 py-4 rounded-2xl bg-stone-100 text-stone-800 rounded-tl-sm flex items-center gap-3 shadow-sm border border-stone-200/50"
                      >
                         <Loader2 className="w-5 h-5 animate-spin text-stone-500" />
                         <span className="text-stone-600 font-medium italic">
                            {persona === 'cat' ? 'Ronronnement...' : 'Analyse structurelle en cours...'}
                         </span>
                      </motion.div>
                    </motion.div>
                  )}
                  <div ref={endOfMessagesRef} className="h-px" />
                </div>

                {/* Chat Input Floating */}
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-white via-white to-transparent pointer-events-none">
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="relative flex items-center w-full max-w-3xl mx-auto shadow-lg rounded-2xl pointer-events-auto"
                  >
                    <input
                      ref={inputRef}
                      disabled={isSending || isEating}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Pose une question sur les documents..."
                      className="w-full py-4 pl-6 pr-14 bg-white border border-stone-200 rounded-2xl focus:border-amber-400 focus:ring-4 focus:ring-amber-400/20 transition-all outline-none disabled:opacity-50 disabled:bg-stone-50 font-medium text-stone-800 shadow-sm"
                    />
                    <button
                      type="submit"
                      disabled={isSending || !input.trim() || isEating}
                      className="absolute right-2.5 p-2.5 text-white bg-amber-500 rounded-xl hover:bg-amber-600 disabled:opacity-50 disabled:hover:bg-amber-500 transition-colors shadow-sm"
                    >
                      <Send className="w-4 h-4 ml-0.5" />
                    </button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* --- RIGHT SIDEBAR (Context / Documents / IDE) --- */}
      <aside className={clsx(
        "bg-stone-50 border-l border-stone-200 flex-col hidden xl:flex z-20 h-full overflow-hidden shrink-0 transition-all",
        persona === 'sirius' ? "w-[450px]" : "w-80"
      )}>
        {persona === 'sirius' && (
           <div className="flex border-b border-stone-200 bg-stone-100 p-2 gap-2 shrink-0">
              <button 
                onClick={() => setActiveRightTab('docs')}
                className={clsx("flex-1 py-1.5 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all", activeRightTab === 'docs' ? "bg-white shadow-sm text-stone-800" : "text-stone-500 hover:bg-stone-200")}
              >
                <Database className="w-3.5 h-3.5" /> Contexte
              </button>
              <button 
                onClick={() => setActiveRightTab('code')}
                className={clsx("flex-1 py-1.5 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all", activeRightTab === 'code' ? "bg-[#1e1e1e] shadow-sm text-stone-300" : "text-stone-500 hover:bg-stone-200")}
              >
                <FolderTree className="w-3.5 h-3.5" /> Code {generatedFiles.length > 0 && <span className="bg-blue-600 text-white px-1.5 rounded-full text-[9px]">{generatedFiles.length}</span>}
              </button>
              <button 
                onClick={() => setActiveRightTab('preview')}
                className={clsx("flex-1 py-1.5 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all", activeRightTab === 'preview' ? "bg-white shadow-sm text-emerald-600" : "text-stone-500 hover:bg-stone-200")}
              >
                <Play className="w-3.5 h-3.5" /> Preview
              </button>
           </div>
        )}

        {/* --- DOCS TAB (Default & Sirius Context) --- */}
        {activeRightTab === 'docs' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-6 border-b border-stone-200 bg-white shadow-sm z-10 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg text-stone-800">Contexte RAG</h2>
                <span className="bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap">
                  {docs.length} Doc{docs.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-stone-500 leading-relaxed mb-4">L'ensemble de ces documents est injecté en contexte lors du calcul de la réponse.</p>
              
              <button 
                onClick={() => setViewMode('docs')}
                className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white font-medium rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Ajouter des documents
              </button>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              {docs.length === 0 && !isEating ? (
                 <div className="flex flex-col items-center justify-center h-40 text-stone-400 text-center opacity-70">
                   <Database className="w-8 h-8 mb-3 opacity-50" />
                   <p className="text-sm font-medium text-stone-500">Aucun document indexé</p>
                   <p className="text-xs mt-1 max-w-[200px] text-stone-400">Le système n'a aucune donnée sur laquelle raisonner.</p>
                 </div>
              ) : (
                <>
                  {docs.map(doc => (
                     <div key={doc.id} className="bg-white border border-stone-200 rounded-xl p-3 shadow-sm relative group hover:border-amber-300 transition-colors">
                       <div className="flex items-start gap-3 w-full">
                         <div className="p-2 bg-red-50 text-red-500 rounded-lg shrink-0">
                           <FileText className="w-5 h-5" />
                         </div>
                         <div className="flex-1 min-w-0 pr-4">
                           <h3 className="font-semibold text-xs text-stone-800 truncate" title={doc.name}>
                             {doc.name}
                           </h3>
                           <div className="flex items-center gap-2 mt-1 text-[10px] text-stone-500 font-medium">
                              <span>{formatBytes(doc.size)}</span>
                           </div>
                           <div className="mt-2 flex items-center">
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">
                                <CheckCircle2 className="w-2.5 h-2.5" /> Prêt
                              </span>
                           </div>
                         </div>
                       </div>
                       <button 
                         onClick={() => removeDoc(doc.id)}
                         title="Supprimer ce document"
                         className="absolute top-2 right-2 p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                       </button>
                     </div>
                  ))}

                  {isEating && eatingFile && (
                    <div className="bg-white border border-amber-300 rounded-xl p-3 shadow-sm relative animate-pulse flex items-start gap-3">
                       <div className="p-2 bg-amber-50 text-amber-500 rounded-lg shrink-0">
                         <Loader2 className="w-5 h-5 animate-spin" />
                       </div>
                       <div className="flex-1 min-w-0">
                         <h3 className="font-semibold text-xs text-stone-800 truncate" title={eatingFile.name}>
                           {eatingFile.name}
                         </h3>
                         <div className="flex items-center gap-2 mt-1 text-[10px] text-stone-500 font-medium">
                            <span>{formatBytes(eatingFile.size)}</span>
                         </div>
                         <div className="mt-2 flex items-center">
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded uppercase">
                              Indexation...
                            </span>
                         </div>
                       </div>
                    </div>
                  )}
                </>
              )}

              {docs.length > 0 && (
                 <div className="mt-8 pt-4 border-t border-stone-200">
                   <div className="flex items-center justify-between text-xs mb-2">
                     <span className="text-stone-500 font-medium">Poids en contexte</span>
                     <span className="font-bold text-stone-800">{formatBytes(totalSize)} / {formatBytes(MAX_TOTAL_SIZE)}</span>
                   </div>
                   <div className="w-full bg-stone-200 rounded-full h-1.5 overflow-hidden">
                     <div className="bg-amber-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (totalSize / MAX_TOTAL_SIZE) * 100)}%` }}></div>
                   </div>
                 </div>
              )}
            </div>
          </div>
        )}

        {/* --- CODE TAB (Sirius Workspace) --- */}
        {activeRightTab === 'code' && (
           <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e] text-stone-300">
              {generatedFiles.length === 0 ? (
                 <div className="flex-1 flex flex-col items-center justify-center opacity-50 p-6 text-center">
                    <LayoutTemplate className="w-12 h-12 mb-4 opacity-50" />
                    <p className="font-bold text-white text-sm">Workspace Vide</p>
                    <p className="text-xs mt-2 max-w-[250px]">L'agent architecte n'a pas encore généré de code. Les blocs de code Markdown s'afficheront ici.</p>
                 </div>
              ) : (
                 <div className="flex-1 flex flex-row overflow-hidden">
                    {/* File Tree Sidebar */}
                    <div className="w-[140px] border-r border-black/40 bg-[#1e1e1e] flex flex-col shrink-0">
                       <div className="p-3 pb-1 text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1">Explorer</div>
                       <div className="flex-1 overflow-y-auto py-1">
                         {generatedFiles.map((file) => (
                           <button 
                             key={file.id} 
                             onClick={() => setSelectedFileId(file.id)}
                             className={clsx(
                               "w-full px-3 py-1.5 flex items-center gap-2 text-xs font-mono transition-colors text-left truncate",
                               selectedFileId === file.id ? "bg-[#37373d] text-white" : "bg-transparent text-stone-400 hover:text-stone-300 hover:bg-[#2d2d2d]"
                             )}
                             title={file.name}
                           >
                             <FileCode2 className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                             <span className="truncate">{file.name}</span>
                           </button>
                         ))}
                       </div>
                    </div>
                    {/* File Content */}
                    <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
                       <div className="bg-[#252526] px-3 py-2 border-b border-black/40 text-xs font-mono text-stone-300 truncate flex items-center gap-2 shrink-0">
                          <FileCode2 className="w-4 h-4 text-blue-400" />
                          {generatedFiles.find(f => f.id === selectedFileId)?.name}
                       </div>
                       <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed selection:bg-blue-900/50 break-words">
                          <pre><code className={clsx("language-" + generatedFiles.find(f => f.id === selectedFileId)?.language)}>{generatedFiles.find(f => f.id === selectedFileId)?.content || ''}</code></pre>
                       </div>
                    </div>
                 </div>
              )}
           </div>
        )}

        {/* --- PREVIEW TAB --- */}
        {activeRightTab === 'preview' && (
           <div className="flex-1 flex flex-col overflow-hidden bg-white text-stone-800">
              <div className="flex p-2 bg-stone-100 border-b border-stone-200 items-center justify-center gap-2 text-xs text-stone-500 font-mono">
                 <Laptop className="w-4 h-4" /> localhost:3000
              </div>
              <div className="flex-1 flex flex-col items-center justify-center opacity-60 p-6 text-center">
                 <Play className="w-12 h-12 mb-4 opacity-50 text-emerald-500" />
                 <p className="font-bold text-stone-800">Preview Suspendue</p>
                 <p className="text-xs mt-2 text-stone-500 max-w-[250px]">L'exécution du code en direct (Sandbox) sera activée dans la prochaine version du Studio.</p>
              </div>
           </div>
        )}
      </aside>
    </div>
  );
}
