import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  CircleHelp,
  Clock3,
  Compass,
  Eye,
  EyeOff,
  Heart,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stars,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { genres, starterCharacters } from './data/characters.js';
import { generateAIImage, isNativeApp, loadAISettings, saveAISettings, sendAIMessage, testAIProvider } from './ai.js';

const KEYS = {
  characters: 'miryi-characters-v1',
  threads: 'miryi-threads-v1',
  favorites: 'miryi-favorites-v1',
};

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timestamp() {
  return new Date().toISOString();
}

function App() {
  const [characters, setCharacters] = useState(() => readStorage(KEYS.characters, starterCharacters));
  const [threads, setThreads] = useState(() => readStorage(KEYS.threads, {}));
  const [favorites, setFavorites] = useState(() => readStorage(KEYS.favorites, []));
  const [view, setView] = useState('discover');
  const [activeCharacterId, setActiveCharacterId] = useState(null);
  const [settings, setSettings] = useState({
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini',
    imageModel: 'gpt-image-1',
    apiKeySet: false,
    configured: false,
  });
  const [settingsReady, setSettingsReady] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem(KEYS.characters, JSON.stringify(characters));
  }, [characters]);
  useEffect(() => {
    localStorage.setItem(KEYS.threads, JSON.stringify(threads));
  }, [threads]);
  useEffect(() => {
    localStorage.setItem(KEYS.favorites, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    loadAISettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setSettingsReady(true));
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const activeCharacter = characters.find((character) => character.id === activeCharacterId) || null;
  const activeMessages = activeCharacter
    ? (threads[activeCharacter.id] || [{ id: 'welcome', role: 'assistant', content: activeCharacter.greeting, createdAt: timestamp() }])
    : [];

  function notify(message) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3400);
  }

  function openChat(character) {
    setActiveCharacterId(character.id);
    setThreads((current) => current[character.id]
      ? current
      : { ...current, [character.id]: [{ id: makeId(), role: 'assistant', content: character.greeting, createdAt: timestamp() }] });
    setView('chat');
  }

  function openEditor(character = null) {
    setEditingCharacter(character);
    setEditorOpen(true);
  }

  function saveCharacter(character) {
    setCharacters((current) => {
      const existing = current.some((item) => item.id === character.id);
      return existing
        ? current.map((item) => item.id === character.id ? character : item)
        : [character, ...current];
    });
    setEditorOpen(false);
    setEditingCharacter(null);
    notify(editingCharacter ? 'Персонаж обновлён' : 'Персонаж добавлен в библиотеку');
  }

  function toggleFavorite(id) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function deleteCharacter(character) {
    if (!window.confirm(`Удалить персонажа «${character.name}» и его переписку?`)) return;
    setCharacters((current) => current.filter((item) => item.id !== character.id));
    setThreads((current) => {
      const next = { ...current };
      delete next[character.id];
      return next;
    });
    setFavorites((current) => current.filter((item) => item !== character.id));
    notify('Персонаж удалён');
  }

  async function saveProvider(payload) {
    const result = await saveAISettings(payload);
    setSettings(result);
    return result;
  }

  async function testProvider(payload) {
    await saveProvider(payload);
    return testAIProvider();
  }

  function addMessage(characterId, message) {
    setThreads((current) => ({
      ...current,
      [characterId]: [...(current[characterId] || []), { id: makeId(), createdAt: timestamp(), ...message }],
    }));
  }

  async function sendMessage(rawText) {
    if (!activeCharacter || chatBusy) return;
    const text = rawText.trim();
    if (!text) return;
    const userMessage = { id: makeId(), role: 'user', content: text, createdAt: timestamp() };
    const currentMessages = threads[activeCharacter.id] || [{ id: makeId(), role: 'assistant', content: activeCharacter.greeting, createdAt: timestamp() }];
    const nextMessages = [...currentMessages, userMessage];
    setThreads((current) => ({ ...current, [activeCharacter.id]: nextMessages }));
    setChatBusy(true);

    try {
      const payload = {
        character: activeCharacter,
        messages: nextMessages.filter((message) => message.role === 'user' || message.role === 'assistant').map(({ role, content }) => ({ role, content })),
      };
      const result = await sendAIMessage(payload);
      addMessage(activeCharacter.id, { role: 'assistant', content: result.message });
    } catch (error) {
      if (error.status === 409) {
        const demoResponse = `*${activeCharacter.name} внимательно прислушивается и чуть улыбается.* «Хорошее начало. Давай сделаем эту историю нашей — расскажи, что ты замечаешь вокруг?»`;
        addMessage(activeCharacter.id, { role: 'assistant', content: demoResponse, isDemo: true });
        notify('Сейчас демо-режим. Добавь API-ключ в настройках, чтобы подключить живую модель.');
      } else {
        notify(error.message || 'Не удалось получить ответ. Проверь подключение в настройках.');
      }
    } finally {
      setChatBusy(false);
    }
  }

  async function generateImage(prompt) {
    if (!activeCharacter || imageBusy) return;
    setImageBusy(true);
    try {
      const result = await generateAIImage({ prompt, character: activeCharacter });
      addMessage(activeCharacter.id, { role: 'assistant', type: 'image', content: result.imageUrl, prompt: result.prompt });
      setImageModalOpen(false);
      notify('Изображение добавлено в историю');
    } catch (error) {
      throw error;
    } finally {
      setImageBusy(false);
    }
  }

  const pageTitle = view === 'discover' ? 'Открыть новый мир' : view === 'chats' ? 'Твои разговоры' : view === 'library' ? 'Твоя библиотека' : 'Настройки';

  return (
    <div className="app-shell">
      <Sidebar view={view} setView={setView} onCreate={() => openEditor()} settings={settings} />
      <main className="main-column">
        {view === 'chat' && activeCharacter ? (
          <ChatScreen
            character={activeCharacter}
            messages={activeMessages}
            busy={chatBusy}
            configured={settings.configured}
            onBack={() => setView('discover')}
            onSend={sendMessage}
            onGenerate={() => setImageModalOpen(true)}
            onSettings={() => setView('settings')}
          />
        ) : (
          <>
            <TopBar title={pageTitle} view={view} settings={settings} onSettings={() => setView('settings')} />
            <div className="page-viewport">
              {view === 'discover' && (
                <DiscoverScreen
                  characters={characters}
                  favorites={favorites}
                  onOpen={openChat}
                  onFavorite={toggleFavorite}
                  onCreate={() => openEditor()}
                />
              )}
              {view === 'chats' && (
                <ConversationsScreen characters={characters} threads={threads} onOpen={openChat} />
              )}
              {view === 'library' && (
                <LibraryScreen
                  characters={characters}
                  favorites={favorites}
                  onOpen={openChat}
                  onFavorite={toggleFavorite}
                  onCreate={() => openEditor()}
                  onEdit={openEditor}
                  onDelete={deleteCharacter}
                />
              )}
              {view === 'settings' && (
                <SettingsScreen
                  settings={settings}
                  ready={settingsReady}
                  native={isNativeApp}
                  onSave={saveProvider}
                  onTest={testProvider}
                  onNotify={notify}
                />
              )}
            </div>
          </>
        )}
      </main>
      {view !== 'chat' && <MobileNav view={view} setView={setView} />}
      {editorOpen && (
        <CharacterEditor
          initial={editingCharacter}
          onClose={() => { setEditorOpen(false); setEditingCharacter(null); }}
          onSave={saveCharacter}
        />
      )}
      {imageModalOpen && activeCharacter && (
        <ImageGenerator
          character={activeCharacter}
          busy={imageBusy}
          configured={settings.apiKeySet}
          onClose={() => setImageModalOpen(false)}
          onGenerate={generateImage}
          onSettings={() => { setImageModalOpen(false); setView('settings'); }}
        />
      )}
      {toast && <div className="toast" role="status"><Sparkles size={16} />{toast}</div>}
    </div>
  );
}

function Sidebar({ view, setView, onCreate, settings }) {
  const navItems = [
    { id: 'discover', label: 'Обзор', icon: Compass },
    { id: 'chats', label: 'Диалоги', icon: MessageCircle },
    { id: 'library', label: 'Мои персонажи', icon: UserRound },
  ];
  return (
    <aside className="sidebar">
      <button className="brand-lockup" onClick={() => setView('discover')} aria-label="Миры — на главную">
        <span className="brand-icon"><Sparkles size={19} fill="currentColor" /></span>
        <span>миры<span className="brand-period">.</span></span>
      </button>
      <div className="sidebar-section-label">ТВОЁ ПРОСТРАНСТВО</div>
      <nav className="sidebar-nav" aria-label="Основная навигация">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-link ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
            <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
            {id === 'chats' && <span className="nav-spark">✦</span>}
          </button>
        ))}
      </nav>
      <button className="sidebar-create" onClick={onCreate}>
        <span className="create-icon"><Plus size={17} /></span>
        <span><strong>Новый персонаж</strong><small>Создай свою историю</small></span>
      </button>
      <div className="sidebar-bottom">
        <div className={`provider-pill ${settings.configured ? 'is-ready' : ''}`}>
          <span className="provider-dot" />
          <span>{settings.configured ? 'ИИ подключён' : 'Демо-режим'}</span>
          <span className="provider-status">{settings.configured ? <Check size={14} /> : <Sparkles size={14} />}</span>
        </div>
        <button className={`nav-link settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
          <Settings2 size={19} strokeWidth={1.8} /><span>Настройки</span>
        </button>
        <div className="sidebar-profile">
          <div className="profile-avatar">Н</div>
          <div className="profile-copy"><strong>Мой профиль</strong><small>Место для историй</small></div>
          <MoreHorizontal size={18} className="profile-more" />
        </div>
      </div>
    </aside>
  );
}

function TopBar({ title, view, settings, onSettings }) {
  return (
    <header className="topbar">
      <div className="mobile-brand"><span className="brand-icon"><Sparkles size={17} fill="currentColor" /></span><strong>миры<span className="brand-period">.</span></strong></div>
      <div className="topbar-mobile-title">{title}</div>
      <div className="topbar-right">
        <div className={`topbar-mode ${settings.configured ? 'ready' : ''}`}>
          <span className="provider-dot" />{settings.configured ? 'ИИ подключён' : 'Демо-режим'}
        </div>
        <button className={`icon-button topbar-settings ${view === 'settings' ? 'selected' : ''}`} onClick={onSettings} aria-label="Открыть настройки">
          <Settings2 size={19} />
        </button>
        <div className="topbar-avatar">Н</div>
      </div>
    </header>
  );
}

function MobileNav({ view, setView }) {
  const items = [
    { id: 'discover', label: 'Обзор', icon: Compass },
    { id: 'chats', label: 'Диалоги', icon: MessageCircle },
    { id: 'library', label: 'Персонажи', icon: UserRound },
    { id: 'settings', label: 'Настройки', icon: Settings2 },
  ];
  return (
    <nav className="mobile-nav" aria-label="Навигация">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`mobile-nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
          <Icon size={20} strokeWidth={view === id ? 2.3 : 1.8} /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function CharacterAvatar({ character, size = 'normal' }) {
  return (
    <div className={`character-avatar ${character.color || 'lavender'} avatar-${size}`} aria-hidden="true">
      <span className="avatar-halo" />
      <span className="avatar-emoji">{character.emoji || '✨'}</span>
      <span className="avatar-star star-one">✦</span>
      <span className="avatar-star star-two">✧</span>
    </div>
  );
}

function DiscoverScreen({ characters, favorites, onOpen, onFavorite, onCreate }) {
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Все истории');
  const featured = characters.find((character) => character.featured) || characters[0];
  const filteredCharacters = useMemo(() => characters.filter((character) => {
    const matchesQuery = `${character.name} ${character.tagline} ${character.genre}`.toLowerCase().includes(query.toLowerCase());
    const matchesGenre = genre === 'Все истории' || character.genre === genre;
    return matchesQuery && matchesGenre;
  }), [characters, genre, query]);

  return (
    <div className="page-content discover-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow"><span className="eyebrow-spark">✦</span> ТВОЁ ВРЕМЯ ДЛЯ ИСТОРИИ</p>
          <h1>Куда отправимся<br className="desktop-break" /> сегодня?</h1>
          <p className="welcome-subtitle">Встреть персонажа. Придумай сюжет. Посмотри, куда он приведёт.</p>
        </div>
        <button className="create-button" onClick={onCreate}><Plus size={17} />Создать персонажа</button>
      </section>

      {featured && <section className="feature-card">
        <div className="feature-copy">
          <div className="feature-kicker"><span className="live-dot" /> ИСТОРИЯ НЕДЕЛИ</div>
          <h2>Город, который<br />помнит всё.</h2>
          <p>Старые ворота открылись. Внутри кто-то оставил свет — и ждёт именно тебя.</p>
          <button className="feature-cta" onClick={() => onOpen(featured)}>Начать историю <ArrowRight size={17} /></button>
          <div className="feature-social"><div className="mini-stack"><span>🌙</span><span>🪐</span><span>🧩</span></div><span>Уже исследуют <strong>{featured.chats || '2,1 тыс.'}</strong></span></div>
        </div>
        <div className="feature-art" aria-hidden="true">
          <div className="feature-orbit orbit-one" /><div className="feature-orbit orbit-two" />
          <div className="feature-moon" />
          <div className="feature-tower tower-back" /><div className="feature-tower tower-front" />
          <div className="feature-window window-one" /><div className="feature-window window-two" />
          <div className="feature-character"><CharacterAvatar character={featured} size="hero" /></div>
          <div className="feature-caption"><Sparkles size={13} /> ЭПИЗОД 01 <span>·</span> ПЕРВАЯ ВСТРЕЧА</div>
        </div>
      </section>}

      <section className="discover-section">
        <div className="section-heading">
          <div><p className="eyebrow">НАЧНИ С ИСКРЫ</p><h2>Истории для тебя</h2></div>
          <button className="quiet-link" onClick={onCreate}>Создать свою <ArrowRight size={15} /></button>
        </div>
        <div className="discovery-controls">
          <div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти персонажа или жанр" aria-label="Найти персонажа или жанр" /></div>
          <div className="genre-list" aria-label="Фильтр по жанрам">
            {genres.map((item) => <button key={item} className={`genre-chip ${genre === item ? 'active' : ''}`} onClick={() => setGenre(item)}>{item}</button>)}
          </div>
        </div>
        {filteredCharacters.length ? (
          <div className="character-grid">
            {filteredCharacters.map((character, index) => (
              <CharacterCard key={character.id} character={character} favorite={favorites.includes(character.id)} onOpen={onOpen} onFavorite={onFavorite} index={index} />
            ))}
          </div>
        ) : (
          <div className="empty-state small-empty"><span className="empty-icon"><Search size={22} /></span><h3>Ничего не нашлось</h3><p>Попробуй изменить поиск или выбрать другой жанр.</p><button className="text-button" onClick={() => { setQuery(''); setGenre('Все истории'); }}>Сбросить фильтры</button></div>
        )}
      </section>
      <div className="privacy-caption"><ShieldCheck size={14} /> Истории сохраняются на этом устройстве</div>
    </div>
  );
}

function CharacterCard({ character, favorite, onOpen, onFavorite, index = 0, owned = false, onEdit, onDelete }) {
  return (
    <article className={`character-card card-${character.color || 'lavender'}`} style={{ '--card-order': index }}>
      <div className="card-art" onClick={() => onOpen(character)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(character); }}>
        <div className="card-art-grid" />
        <span className="card-genre">{character.genre}</span>
        <CharacterAvatar character={character} size="card" />
        <span className="art-motif">✧</span>
        <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} onClick={(event) => { event.stopPropagation(); onFavorite(character.id); }} aria-label={favorite ? 'Убрать из избранного' : 'Добавить в избранное'}>
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        {owned && <div className="owned-actions">
          <button onClick={(event) => { event.stopPropagation(); onEdit(character); }} aria-label="Редактировать"><Settings2 size={15} /></button>
          <button onClick={(event) => { event.stopPropagation(); onDelete(character); }} aria-label="Удалить"><Trash2 size={15} /></button>
        </div>}
        <div className="card-art-bottom"><span className="card-art-online" />персонаж онлайн</div>
      </div>
      <div className="card-content">
        <div className="card-title-line"><h3>{character.name}</h3><span className="card-stars"><Sparkles size={12} fill="currentColor" /> {character.chats || 'Новый'}</span></div>
        <p className="card-tagline">{character.tagline}</p>
        <div className="card-bottom-line"><span className="card-style"><span className="tiny-diamond">✦</span>{character.genre}</span><button className="card-open" onClick={() => onOpen(character)} aria-label={`Начать чат с ${character.name}`}>Встретиться <ArrowRight size={14} /></button></div>
      </div>
    </article>
  );
}

function ConversationsScreen({ characters, threads, onOpen }) {
  const recent = useMemo(() => Object.entries(threads)
    .map(([id, messages]) => ({ character: characters.find((item) => item.id === id), messages }))
    .filter((thread) => thread.character)
    .sort((a, b) => new Date(b.messages.at(-1)?.createdAt || 0) - new Date(a.messages.at(-1)?.createdAt || 0)), [characters, threads]);

  return (
    <div className="page-content secondary-page">
      <div className="page-heading-block"><p className="eyebrow">ПРОДОЛЖИ С ТОГО МЕСТА</p><h1>Твои разговоры</h1><p>Каждая история ждёт, когда ты вернёшься.</p></div>
      {recent.length ? <div className="conversation-list">
        {recent.map(({ character, messages }) => {
          const last = messages.at(-1);
          return <button className="conversation-row" key={character.id} onClick={() => onOpen(character)}>
            <CharacterAvatar character={character} size="list" />
            <div className="conversation-copy"><div className="conversation-title"><h3>{character.name}</h3><span><Clock3 size={12} />{last?.createdAt ? new Date(last.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'сейчас'}</span></div><p>{last?.type === 'image' ? '✦ Изображение создано' : last?.content || character.greeting}</p></div>
            <ArrowRight size={17} className="conversation-arrow" />
          </button>;
        })}
      </div> : <div className="empty-state"><span className="empty-icon"><MessageCircle size={23} /></span><h3>Здесь будут твои истории</h3><p>Начни диалог с персонажем, и он появится в этом списке.</p><button className="primary-button" onClick={() => onOpen(characters[0])}>Выбрать персонажа <ArrowRight size={16} /></button></div>}
    </div>
  );
}

function LibraryScreen({ characters, favorites, onOpen, onFavorite, onCreate, onEdit, onDelete }) {
  const [tab, setTab] = useState('created');
  const items = tab === 'favorites'
    ? characters.filter((character) => favorites.includes(character.id))
    : characters.filter((character) => character.custom);
  return (
    <div className="page-content secondary-page library-page">
      <div className="library-heading"><div className="page-heading-block"><p className="eyebrow">ТВОИ МИРЫ, ТВОИ ПРАВИЛА ИСТОРИИ</p><h1>Твоя библиотека</h1><p>Собери персонажей, к которым захочется возвращаться.</p></div><button className="create-button" onClick={onCreate}><Plus size={17} />Новый персонаж</button></div>
      <div className="library-tabs"><button className={tab === 'created' ? 'active' : ''} onClick={() => setTab('created')}>Созданные <span>{characters.filter((character) => character.custom).length}</span></button><button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}>Избранное <span>{favorites.length}</span></button></div>
      {items.length ? <div className="character-grid">
        {items.map((character, index) => <CharacterCard key={character.id} character={character} favorite={favorites.includes(character.id)} onOpen={onOpen} onFavorite={onFavorite} index={index} owned={tab === 'created'} onEdit={onEdit} onDelete={onDelete} />)}
      </div> : <div className="empty-state"><span className="empty-icon">{tab === 'created' ? <Plus size={23} /> : <Heart size={23} />}</span><h3>{tab === 'created' ? 'Здесь пока пусто' : 'Избранное ждёт свою первую историю'}</h3><p>{tab === 'created' ? 'Создай персонажа с собственной личностью, сеттингом и началом.' : 'Отмечай сердцем персонажей в обзоре, чтобы сохранить их здесь.'}</p>{tab === 'created' && <button className="primary-button" onClick={onCreate}><Plus size={16} />Создать персонажа</button>}</div>}
    </div>
  );
}

function ChatScreen({ character, messages, busy, configured, onBack, onSend, onGenerate, onSettings }) {
  const transcriptRef = useRef(null);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  function submit(event) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    onSend(draft);
    setDraft('');
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="chat-page">
      <header className="chat-header">
        <button className="chat-back icon-button" onClick={onBack} aria-label="Назад"><ChevronLeft size={22} /></button>
        <CharacterAvatar character={character} size="chat" />
        <div className="chat-character-copy"><strong>{character.name}</strong><span><span className="card-art-online" />{character.tagline}</span></div>
        <div className="chat-header-actions"><button className="chat-action" onClick={onGenerate}><ImagePlus size={17} /><span>Образ</span></button><button className="icon-button chat-more" aria-label="Ещё"><MoreHorizontal size={20} /></button></div>
      </header>
      <div className="chat-context-row"><Sparkles size={13} /><span>{character.genre}</span><span className="context-separator">·</span><span>{character.scenario}</span></div>
      {!configured && <div className="demo-notice"><Sparkles size={15} /><span><strong>Демо-режим</strong> — подключи модель, чтобы персонаж отвечал с помощью ИИ.</span><button onClick={onSettings}>Настроить <ArrowRight size={13} /></button></div>}
      <div className="chat-transcript" ref={transcriptRef}>
        <div className="chat-date-divider"><span /><small>ИСТОРИЯ НАЧИНАЕТСЯ</small><span /></div>
        <div className="welcome-message">
          <CharacterAvatar character={character} size="message" />
          <div><span className="welcome-label">{character.name} начинает историю</span><p>{character.greeting}</p><time>Сейчас</time></div>
        </div>
        {messages.slice(1).map((message) => <ChatMessage key={message.id} message={message} character={character} />)}
        {busy && <div className="typing-row"><CharacterAvatar character={character} size="typing" /><div className="typing-bubble"><span /><span /><span /></div><span className="typing-label">{character.name} печатает</span></div>}
        <div className="scroll-anchor" />
      </div>
      <form className="composer-wrap" onSubmit={submit}>
        <div className="composer">
          <button type="button" className="composer-add" onClick={onGenerate} aria-label="Создать изображение"><ImagePlus size={20} /></button>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={`Напиши ${character.name}...`} rows={1} aria-label="Сообщение" />
          <button className="send-button" disabled={!draft.trim() || busy} aria-label="Отправить сообщение"><Send size={17} fill="currentColor" /></button>
        </div>
        <div className="composer-foot"><span><Sparkles size={12} /> История создаётся вместе с тобой</span><span>Enter — отправить · Shift + Enter — новая строка</span></div>
      </form>
    </section>
  );
}

function ChatMessage({ message, character }) {
  const user = message.role === 'user';
  return (
    <div className={`message-row ${user ? 'user-message-row' : 'assistant-message-row'}`}>
      {!user && <CharacterAvatar character={character} size="message" />}
      <div className={`message-bubble ${user ? 'user-bubble' : 'assistant-bubble'}`}>
        {message.type === 'image' ? <div className="generated-image-wrap"><img src={message.content} alt={`Изображение: ${message.prompt}`} loading="lazy" /><div className="generated-image-caption"><Sparkles size={13} /><span>{message.prompt}</span></div></div> : <p>{message.content}</p>}
        {message.isDemo && <span className="demo-message-label">ДЕМО-ОТВЕТ</span>}
        <time>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
      </div>
      {user && <div className="user-message-avatar">Н</div>}
    </div>
  );
}

function SettingsScreen({ settings, ready, native, onSave, onTest, onNotify }) {
  const [form, setForm] = useState({ baseUrl: settings.baseUrl, chatModel: settings.chatModel, imageModel: settings.imageModel, apiKey: '' });
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm((current) => ({ ...current, baseUrl: settings.baseUrl, chatModel: settings.chatModel, imageModel: settings.imageModel }));
  }, [settings.baseUrl, settings.chatModel, settings.imageModel]);

  function change(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaved(false);
    setTestStatus(null);
  }

  async function handleSave(event) {
    event?.preventDefault();
    setBusy(true);
    setTestStatus(null);
    try {
      await onSave({ ...form, apiKey: form.apiKey });
      setForm((current) => ({ ...current, apiKey: '' }));
      setSaved(true);
      onNotify('Настройки сохранены');
    } catch (error) {
      setTestStatus({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setTestStatus(null);
    try {
      const result = await onTest(form);
      setForm((current) => ({ ...current, apiKey: '' }));
      setTestStatus({ kind: 'success', text: `Подключение работает · ${result.model}` });
      setSaved(true);
    } catch (error) {
      setTestStatus({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    if (!window.confirm('Удалить сохранённый API-ключ?')) return;
    setBusy(true);
    try {
      await onSave({ baseUrl: form.baseUrl, chatModel: form.chatModel, imageModel: form.imageModel, clearApiKey: true });
      setTestStatus({ kind: 'success', text: 'API-ключ удалён. Приложение переключено в демо-режим.' });
    } catch (error) {
      setTestStatus({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-content settings-page">
      <div className="page-heading-block"><p className="eyebrow">ПОДКЛЮЧИ СВОЮ МОДЕЛЬ</p><h1>Настройки</h1><p>Выбери AI-провайдера, задай модели и продолжай создавать истории.</p></div>
      <div className="settings-layout">
        <form className="settings-card" onSubmit={handleSave}>
          <div className="settings-card-head"><div className="settings-card-icon"><KeyRound size={19} /></div><div><h2>Подключение ИИ</h2><p>Поддерживаются API с форматом OpenAI-compatible.</p></div><span className={`connection-badge ${settings.configured ? 'connected' : ''}`}><span className="provider-dot" />{settings.configured ? 'Подключено' : 'Не подключено'}</span></div>
          <div className="settings-fields">
            <label className="form-label">Адрес API <span>Base URL</span><input value={form.baseUrl} onChange={(event) => change('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" autoComplete="url" /></label>
            <label className="form-label">API-ключ <span>{settings.apiKeySet ? 'ключ уже сохранён' : native ? 'сохранится на устройстве без шифрования' : 'хранится на сервере приложения'}</span>
              <div className="key-input-wrap"><input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={(event) => change('apiKey', event.target.value)} placeholder={settings.apiKeySet ? 'Вставь новый, чтобы заменить сохранённый' : 'Вставь API-ключ провайдера'} autoComplete="new-password" /><button type="button" className="field-eye" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            </label>
            <div className="model-fields">
              <label className="form-label">Текстовая модель<input value={form.chatModel} onChange={(event) => change('chatModel', event.target.value)} placeholder="gpt-4o-mini" /></label>
              <label className="form-label">Модель изображений<input value={form.imageModel} onChange={(event) => change('imageModel', event.target.value)} placeholder="gpt-image-1" /></label>
            </div>
            <div className="provider-hint"><CircleHelp size={16} /><p>Например: OpenAI — <code>https://api.openai.com/v1</code>, OpenRouter — <code>https://openrouter.ai/api/v1</code>. Названия моделей зависят от выбранного провайдера.</p></div>
            {testStatus && <div className={`settings-feedback ${testStatus.kind}`}><span>{testStatus.kind === 'success' ? <Check size={16} /> : <CircleHelp size={16} />}</span>{testStatus.text}</div>}
            <div className="settings-buttons"><button className="primary-button" type="submit" disabled={busy || !ready}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saved ? 'Сохранено' : 'Сохранить'}</button><button className="outline-button" type="button" onClick={handleTest} disabled={busy || !ready}><WandSparkles size={16} />Проверить связь</button>{settings.apiKeySet && <button className="clear-key-button" type="button" onClick={clearKey} disabled={busy}>Удалить ключ</button>}</div>
          </div>
        </form>
        <aside className="settings-side-column">
          <div className="security-card"><span className="security-symbol"><LockKeyhole size={19} /></span><h3>{native ? 'Ключ хранится на устройстве' : 'Ключ остаётся на сервере'}</h3><p>{native ? 'Ключ сохраняется в приватных данных приложения, но без шифрования. Не передавай APK с настроенным ключом другим людям.' : <>Ключ не возвращается в браузер и хранится в файле <code>data/settings.json</code> без шифрования. Запускай приложение только для личного использования или за закрытым доступом.</>}</p><div className="security-caption"><ShieldCheck size={14} />{native ? 'Локальные данные приложения' : 'Локальный файл с правами доступа 600'}</div></div>
          <div className="android-card"><div className="android-icon"><Sparkles size={18} /></div><div><h3>{native ? 'Приложение установлено' : 'Установить на Android'}</h3><p>{native ? 'Чаты и персонажи сохраняются на этом устройстве.' : <>Открой страницу в Chrome → меню <MoreHorizontal size={13} /> → «Установить приложение» или «Добавить на главный экран».</>}</p></div></div>
          <div className="provider-note"><Stars size={17} /><div><strong>Провайдер задаёт свои правила</strong><p>Доступность моделей и генерации изображений зависит от выбранного API-провайдера.</p></div></div>
        </aside>
      </div>
    </div>
  );
}

function CharacterEditor({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => initial || {
    name: '', tagline: '', role: '', personality: '', scenario: '', style: '', greeting: '', genre: 'Приключения', emoji: '✨', color: 'lavender',
  });
  const [step, setStep] = useState(1);
  const colors = ['lavender', 'rose', 'blue', 'amber', 'slate', 'mint'];
  const emojis = ['✨', '🌙', '🪐', '🦊', '🧭', '🎭', '🕯️', '🧪', '🎨', '🐉', '🎙️', '📚'];
  const isValid = form.name.trim() && form.role.trim();

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!isValid) return;
    const character = {
      ...form,
      id: initial?.id || makeId(),
      name: form.name.trim(),
      tagline: form.tagline.trim() || form.role.trim(),
      personality: form.personality.trim() || 'Любознательный и выразительный персонаж, который поддерживает совместное развитие истории.',
      scenario: form.scenario.trim() || 'Новая история начинается с неожиданной встречи.',
      style: form.style.trim() || 'Живой диалог, атмосфера и пространство для ответов собеседника.',
      greeting: form.greeting.trim() || `Привет. Я ${form.name.trim()}. Кажется, впереди нас ждёт интересная история. С чего начнём?`,
      genre: form.genre || 'Приключения',
      chats: 'Новый',
      custom: true,
    };
    onSave(character);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="editor-modal" onSubmit={submit}>
        <div className="modal-header"><div><p className="eyebrow">СОЗДАЙ СВОЮ ИСТОРИЮ</p><h2>{initial ? 'Настроить персонажа' : 'Новый персонаж'}</h2></div><button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Закрыть"><X size={20} /></button></div>
        <div className="editor-progress"><span className={step >= 1 ? 'active' : ''} /><span className={step >= 2 ? 'active' : ''} /><small>ШАГ {step} ИЗ 2</small></div>
        {step === 1 ? <div className="editor-body">
          <div className="editor-preview-row"><div className={`editor-preview ${form.color}`}><span>{form.emoji}</span></div><div><strong>Как его зовут?</strong><p>Имя, роль и жанр — основа знакомства.</p></div></div>
          <label className="form-label">Имя персонажа<input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Например, Акира Нова" maxLength={80} required /></label>
          <div className="editor-two-col"><label className="form-label">Короткое описание<input value={form.tagline} onChange={(event) => update('tagline', event.target.value)} placeholder="Капитан звёздного корабля" maxLength={100} /></label><label className="form-label">Жанр<select value={form.genre} onChange={(event) => update('genre', event.target.value)}>{genres.filter((item) => item !== 'Все истории').map((item) => <option key={item}>{item}</option>)}</select></label></div>
          <label className="form-label">Роль и характер персонажа<textarea value={form.personality} onChange={(event) => update('personality', event.target.value)} placeholder="Кто он? Как говорит, чего хочет, что в нём особенного?" rows={3} maxLength={1200} /></label>
          <div className="emoji-chooser"><span className="chooser-label">ОБРАЗ</span><div className="emoji-row">{emojis.map((emoji) => <button type="button" key={emoji} className={form.emoji === emoji ? 'selected' : ''} onClick={() => update('emoji', emoji)}>{emoji}</button>)}</div></div>
          <div className="color-chooser"><span className="chooser-label">ЦВЕТ МИРА</span><div className="color-row">{colors.map((color) => <button type="button" key={color} className={`color-swatch ${color} ${form.color === color ? 'selected' : ''}`} onClick={() => update('color', color)} aria-label={`Выбрать ${color}`} />)}</div></div>
        </div> : <div className="editor-body">
          <div className="editor-preview-row"><div className={`editor-preview ${form.color}`}><span>{form.emoji}</span></div><div><strong>Где начнётся история?</strong><p>Настрой первую сцену и стиль диалога.</p></div></div>
          <label className="form-label">Сеттинг и завязка<textarea value={form.scenario} onChange={(event) => update('scenario', event.target.value)} placeholder="Опиши место, время и то, что происходит в первой сцене..." rows={3} maxLength={1000} /></label>
          <label className="form-label">Стиль общения<textarea value={form.style} onChange={(event) => update('style', event.target.value)} placeholder="Например: атмосферно, с юмором, короткими репликами..." rows={2} maxLength={300} /></label>
          <label className="form-label">Первое сообщение<textarea value={form.greeting} onChange={(event) => update('greeting', event.target.value)} placeholder="С чего персонаж начнёт разговор?" rows={3} maxLength={1200} /></label>
          <div className="prompt-hint"><Sparkles size={15} /> Подсказка: оставь место для ответа — хорошая история создаётся вдвоём.</div>
        </div>}
        <div className="modal-footer"><button type="button" className="outline-button" onClick={() => step === 1 ? onClose() : setStep(1)}>{step === 1 ? 'Отмена' : <><ArrowLeft size={15} />Назад</>}</button>{step === 1 ? <button type="button" className="primary-button" disabled={!isValid} onClick={() => setStep(2)}>Дальше <ArrowRight size={15} /></button> : <button type="submit" className="primary-button"><Sparkles size={15} />{initial ? 'Сохранить' : 'Создать персонажа'}</button>}</div>
      </form>
    </div>
  );
}

function ImageGenerator({ character, busy, configured, onClose, onGenerate, onSettings }) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await onGenerate(prompt.trim());
    } catch (reason) {
      setError(reason.message || 'Не удалось создать изображение.');
    }
  }

  return (
    <div className="modal-backdrop image-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="image-modal" onSubmit={submit}>
        <div className="image-modal-art"><div className="image-modal-orbit" /><div className="image-modal-spark"><WandSparkles size={25} /></div><span>✦</span><span>✧</span><button type="button" className="modal-close image-close" onClick={onClose} disabled={busy} aria-label="Закрыть"><X size={19} /></button></div>
        <div className="image-modal-content"><p className="eyebrow">ДАЙ ИСТОРИИ ОБРАЗ</p><h2>Создать изображение</h2><p className="image-modal-sub">Опиши сцену с <strong>{character.name}</strong> — и добавь её в ваш диалог.</p>
          <label className="form-label">Что происходит в кадре?<textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Например: мы стоим на крыше ночью, внизу мерцают огни города..." rows={4} maxLength={1800} required /></label>
          <div className="image-prompt-footer"><span><Sparkles size={13} />Модель: настройки провайдера</span><span>{prompt.length}/1800</span></div>
          {!configured && <div className="image-config-note"><CircleHelp size={15} />Для генерации подключи API-ключ и модель изображений в настройках.</div>}
          {error && <div className="settings-feedback error"><CircleHelp size={15} />{error}{error.includes('API-ключ') && <button type="button" onClick={onSettings}>Настроить</button>}</div>}
          <button className="primary-button generate-button" type="submit" disabled={busy || !prompt.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{busy ? 'Создаём образ…' : 'Создать образ'}</button>
          <p className="image-provider-caption">Генерация зависит от возможностей и правил выбранного провайдера.</p>
        </div>
      </form>
    </div>
  );
}

export default App;
