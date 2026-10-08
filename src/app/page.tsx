'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { HAPPENINGS } from '@/lib/happenings'

function generateGameCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''

  for (let i = 0; i < 5; i++) {
    code += characters.charAt(
      Math.floor(Math.random() * characters.length)
    )
  }

  return code
}

function shuffle<T>(array: T[]) {
  const result = [...array]

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }

  return result
}

export default function HomePage() {
  const supabase = createClient()

  const [gameName, setGameName] = useState('')
  const [joinCode, setJoinCode] = useState('')

  const [gameMode, setGameMode] = useState<'quick' | 'custom'>(
    'quick'
  )

  const [customText, setCustomText] = useState(
    HAPPENINGS.join('\n')
  )

  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  const [createError, setCreateError] = useState('')
  const [joinError, setJoinError] = useState('')

  const [userName, setUserName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [homeTab, setHomeTab] = useState<'play' | 'history'>('play')
  const [myGames, setMyGames] = useState<Array<{ id: string; code: string; name: string; status: string; created_at?: string }>>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [loadingUser, setLoadingUser] = useState(true)

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        setUserId(user.id)
        setUserName(
          user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email ||
            'Player'
        )
      }

      setLoadingUser(false)
    }

    loadUser()
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function loadMyGames() {
      setHistoryLoading(true)
      try {
        const { data: memberships, error: membershipError } = await supabase
          .from('game_players')
          .select('game_id')
          .eq('user_id', userId)
        if (membershipError) throw membershipError
        const gameIds = [...new Set((memberships ?? []).map((row) => row.game_id))]
        if (gameIds.length === 0) {
          if (!cancelled) setMyGames([])
          return
        }
        const { data, error } = await supabase
          .from('games')
          .select('id, code, name, status, created_at')
          .in('id', gameIds)
          .order('created_at', { ascending: false })
        if (error) throw error
        if (!cancelled) setMyGames(data ?? [])
      } catch (err) {
        console.error('Load game history error:', err)
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }
    loadMyGames()
    return () => { cancelled = true }
  }, [userId, historyRefresh])

  const customHappenings = useMemo(() => {
    return customText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }, [customText])

  const customCount = customHappenings.length

  const duplicateCount =
    customHappenings.length -
    new Set(
      customHappenings.map((item) =>
        item.toLowerCase()
      )
    ).size

  const customBoardSize = Math.sqrt(customCount)
  const customIsPerfectSquare = customCount >= 1 && Number.isInteger(customBoardSize)

  const customIsValid =
    customIsPerfectSquare &&
    duplicateCount === 0 &&
    customHappenings.every(
      (item) => item.length >= 1 && item.length <= 100
    )

  function useDefaultHappenings() {
    setCustomText(HAPPENINGS.join('\n'))
    setGameMode('quick')
    setCreateError('')
  }

  async function createGame() {
    setCreateError('')
    setCreating(true)

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        throw new Error(userError.message)
      }

      if (!user) {
        throw new Error(
          'You must be logged in to create a game.'
        )
      }

      if (!gameName.trim()) {
        throw new Error('Please enter a game name.')
      }

      let happeningsToUse: string[]

      if (gameMode === 'quick') {
        happeningsToUse = HAPPENINGS
      } else {
        if (!customIsPerfectSquare) {
          throw new Error(
            `Choose a perfect-square number of happenings (9, 16, 25, 36, etc.). You currently have ${customCount}.`
          )
        }

        if (duplicateCount > 0) {
          throw new Error(
            'Custom Bingo contains duplicate happenings. Please make each one unique.'
          )
        }

        const tooLong = customHappenings.find(
          (item) => item.length > 100
        )

        if (tooLong) {
          throw new Error(
            'Each happening must contain 100 characters or fewer.'
          )
        }

        happeningsToUse = customHappenings
      }

      let gameCode = ''

      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateGameCode()

        const { data, error } = await supabase
          .from('games')
          .select('id')
          .eq('code', candidate)
          .maybeSingle()

        if (error) {
          throw new Error(error.message)
        }

        if (!data) {
          gameCode = candidate
          break
        }
      }

      if (!gameCode) {
        throw new Error(
          'Could not generate a unique game code.'
        )
      }

      const { data: game, error: gameError } =
        await supabase
          .from('games')
          .insert({
            code: gameCode,
            name: gameName.trim(),
            created_by: user.id,
            status: 'waiting',
          })
          .select('id, code')
          .single()

      if (gameError) {
        throw new Error(gameError.message)
      }

      const happeningsToInsert =
        happeningsToUse.map(
          (text, index) => ({
            game_id: game.id,
            text,
            position: index,
          })
        )

      const {
        data: happeningsData,
        error: happeningsError,
      } = await supabase
        .from('happenings')
        .insert(happeningsToInsert)
        .select('id')

      if (happeningsError) {
        throw new Error(
          happeningsError.message
        )
      }

      if (
        !happeningsData ||
        happeningsData.length !== happeningsToUse.length
      ) {
        throw new Error(
          'Failed to create all happenings.'
        )
      }

      const board = shuffle(
        happeningsData.map(
          (item) => item.id
        )
      )

      const displayName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        'Player'

      const {
        error: playerError,
      } = await supabase
        .from('game_players')
        .insert({
          game_id: game.id,
          user_id: user.id,
          display_name: displayName,
          board,
        })

      if (playerError) {
        throw new Error(
          playerError.message
        )
      }

      window.location.href =
        `/game/${game.code}`
    } catch (err) {
      console.error(
        'Create game error:',
        err
      )

      setCreateError(
        err instanceof Error
          ? err.message
          : 'Failed to create game.'
      )
    } finally {
      setCreating(false)
    }
  }

  async function joinGame() {
    setJoinError('')
    setJoining(true)

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        throw new Error(userError.message)
      }

      if (!user) {
        throw new Error(
          'You must be logged in to join a game.'
        )
      }

      const code =
        joinCode.trim().toUpperCase()

      if (!code) {
        throw new Error(
          'Please enter a game code.'
        )
      }

      if (code.length !== 5) {
        throw new Error(
          'Game codes must contain 5 characters.'
        )
      }

      const {
        data: game,
        error: gameError,
      } = await supabase
        .from('games')
        .select(
          'id, code, status'
        )
        .eq('code', code)
        .maybeSingle()

      if (gameError) {
        throw new Error(
          gameError.message
        )
      }

      if (!game) {
        throw new Error(
          'Game not found. Check the code and try again.'
        )
      }

      if (game.status === 'finished') {
        throw new Error(
          'This game has already finished.'
        )
      }

      const {
        data: existingPlayer,
        error:
          existingPlayerError,
      } = await supabase
        .from('game_players')
        .select('id')
        .eq('game_id', game.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existingPlayerError) {
        throw new Error(
          existingPlayerError.message
        )
      }

      if (!existingPlayer) {
        const {
          data: happenings,
          error:
            happeningsError,
        } = await supabase
          .from('happenings')
          .select('id')
          .eq('game_id', game.id)

        if (happeningsError) {
          throw new Error(
            happeningsError.message
          )
        }

        if (
          !happenings ||
          happenings.length < 1 || !Number.isInteger(Math.sqrt(happenings.length))
        ) {
          throw new Error(
            'This game does not have a valid square-sized board.'
          )
        }

        const board = shuffle(
          happenings.map(
            (item) => item.id
          )
        )

        const displayName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email ||
          'Player'

        const {
          error: playerError,
        } = await supabase
          .from('game_players')
          .insert({
            game_id: game.id,
            user_id: user.id,
            display_name: displayName,
            board,
          })

        if (playerError) {
          throw new Error(
            playerError.message
          )
        }
      }

      window.location.href =
        `/game/${game.code}`
    } catch (err) {
      console.error(
        'Join game error:',
        err
      )

      setJoinError(
        err instanceof Error
          ? err.message
          : 'Failed to join game.'
      )
    } finally {
      setJoining(false)
    }
  }

  async function signIn() {
    const { error } =
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo:
            `${window.location.origin}/auth/callback`,
        },
      })

    if (error) {
      setCreateError(
        error.message
      )
    }
  }

  if (loadingUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mb-4 text-5xl">
            🎯
          </div>

          <p className="text-sm text-gray-400">
            Loading Bingo...
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen overflow-hidden bg-gray-950 text-white">

      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-[-15%] top-[-10%] h-96 w-96 rounded-full bg-green-500/10 blur-3xl" />

        <div className="absolute right-[-15%] top-[25%] h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="absolute bottom-[-15%] left-[25%] h-96 w-96 rounded-full bg-purple-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">

        {/* HEADER */}
        <header className="mb-12 flex items-center justify-between">

          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-2xl shadow-lg">
              🎯
            </div>

            <div>
              <h1 className="text-lg font-black tracking-tight">
                BINGO
              </h1>

              <p className="text-xs text-gray-500">
                Party Edition
              </p>
            </div>
          </div>

          {userName && (
            <div className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/80 px-3 py-2 text-sm text-gray-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-black text-gray-950">
                {userName
                  .charAt(0)
                  .toUpperCase()}
              </span>

              <span className="hidden max-w-[160px] truncate sm:block">
                {userName}
              </span>
            </div>
          )}

        </header>

        {/* HERO */}
        <section className="mb-10 text-center">

          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/80 px-4 py-2 text-xs font-semibold text-gray-300 shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />

            Multiplayer Bingo
          </div>

          <h2 className="mx-auto max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl">
            Your party.
            <br />

            <span className="text-gray-500">
              Your rules.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
            Turn the moments happening around you
            into a multiplayer Bingo game.
            Create a board, invite your friends,
            and race to Bingo.
          </p>

        </section>

        {/* AUTH */}
        {!userName && (
          <section className="mx-auto max-w-md rounded-3xl border border-gray-800 bg-gray-900/90 p-7 text-center shadow-2xl backdrop-blur">

            <div className="mb-4 text-4xl">
              🔐
            </div>

            <h3 className="text-xl font-bold">
              Ready to play?
            </h3>

            <p className="mt-2 mb-6 text-sm leading-relaxed text-gray-400">
              Sign in with Google to create games
              or join your friends.
            </p>

            <button
              type="button"
              onClick={signIn}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 font-bold text-gray-900 shadow-lg transition hover:bg-gray-200 active:scale-[0.99]"
            >
              <span className="font-black">
                G
              </span>

              Continue with Google
            </button>

          </section>
        )}

        {/* MAIN */}
        {userName && (
          <>
            <div className="mb-6 flex gap-2 rounded-2xl border border-gray-800 bg-gray-900/80 p-1">
              <button type="button" onClick={() => setHomeTab('play')} className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold transition ${homeTab === 'play' ? 'bg-green-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}>🎮 Create / Join</button>
              <button type="button" onClick={() => setHomeTab('history')} className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold transition ${homeTab === 'history' ? 'bg-green-500 text-gray-950' : 'text-gray-400 hover:text-white'}`}>📚 My Games</button>
            </div>

            {homeTab === 'history' ? (
              <section className="rounded-3xl border border-gray-800 bg-gray-900/90 p-6 shadow-xl sm:p-8">
                <div className="mb-6 flex items-center justify-between gap-3"><div><h3 className="text-2xl font-bold">My Games</h3><p className="mt-1 text-sm text-gray-500">Reopen games you have joined, whether active or finished.</p></div><button type="button" onClick={() => setHistoryRefresh((value) => value + 1)} className="rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-gray-300 hover:bg-gray-700">Refresh</button></div>
                {historyLoading ? <p className="py-10 text-center text-sm text-gray-500">Loading your games…</p> : myGames.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-700 px-5 py-12 text-center"><p className="font-bold text-gray-300">No games yet</p><p className="mt-2 text-sm text-gray-500">Games you create or join will appear here.</p><button type="button" onClick={() => setHomeTab('play')} className="mt-4 rounded-xl bg-green-500 px-4 py-2 font-bold text-gray-950">Create your first game</button></div> : <div className="space-y-3">{myGames.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-gray-800 bg-gray-950/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-white">{item.name}</h4><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${item.status === 'finished' ? 'bg-yellow-500/10 text-yellow-300' : item.status === 'active' ? 'bg-green-500/10 text-green-300' : 'bg-blue-500/10 text-blue-300'}`}>{item.status}</span></div><p className="mt-1 text-xs text-gray-500">Code: <span className="font-mono tracking-widest">{item.code}</span>{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString()}` : ''}</p></div><a href={`/game/${item.code}`} className="rounded-xl bg-gray-800 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-gray-700">Open game →</a></div>)}</div>}
              </section>
            ) : (
            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">

              {/* CREATE */}
              <section className="rounded-3xl border border-gray-800 bg-gray-900/90 p-6 shadow-xl backdrop-blur sm:p-8">

                <div className="mb-7 flex items-start justify-between">

                  <div>
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10 text-2xl">
                      ✨
                    </div>

                    <h3 className="text-2xl font-bold">
                      Create a game
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      Build your own Bingo party.
                    </p>
                  </div>

                  <span className="rounded-full bg-green-500/10 px-3 py-1 text-[10px] font-black tracking-wider text-green-400">
                    HOST
                  </span>

                </div>

                {/* GAME NAME */}
                <label className="mb-2 block text-sm font-semibold text-gray-300">
                  Game name
                </label>

                <input
                  type="text"
                  value={gameName}
                  onChange={(event) =>
                    setGameName(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      'Enter'
                    ) {
                      createGame()
                    }
                  }}
                  placeholder="Summer Party"
                  maxLength={50}
                  className="mb-5 w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3.5 text-white outline-none transition placeholder:text-gray-700 focus:border-green-500 focus:ring-2 focus:ring-green-500/10"
                />

                {/* MODE */}
                <div className="mb-5">

                  <label className="mb-2 block text-sm font-semibold text-gray-300">
                    Bingo type
                  </label>

                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-950 p-1">

                    <button
                      type="button"
                      onClick={() => {
                        setGameMode('quick')
                        setCreateError('')
                      }}
                      className={`rounded-lg px-3 py-3 text-sm font-bold transition ${
                        gameMode === 'quick'
                          ? 'bg-gray-800 text-white shadow'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      ⚡ Quick Game
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setGameMode('custom')
                        setCreateError('')
                      }}
                      className={`rounded-lg px-3 py-3 text-sm font-bold transition ${
                        gameMode === 'custom'
                          ? 'bg-gray-800 text-white shadow'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      ✏️ Custom
                    </button>

                  </div>
                </div>

                {/* QUICK GAME */}
                {gameMode === 'quick' && (
                  <div className="mb-5 rounded-2xl border border-gray-800 bg-gray-950 p-4">

                    <div className="flex items-center justify-between">

                      <div>
                        <p className="font-bold">
                          Party Edition
                        </p>

                        <p className="mt-1 text-xs text-gray-600">
                          Your default ${HAPPENINGS.length} happenings
                        </p>
                      </div>

                      <div className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-black text-green-400">
                        {HAPPENINGS.length} / {HAPPENINGS.length}
                      </div>

                    </div>

                  </div>
                )}

                {/* CUSTOM */}
                {gameMode === 'custom' && (
                  <div className="mb-5">

                    <div className="mb-2 flex items-end justify-between">

                      <label className="block text-sm font-semibold text-gray-300">
                        Your happenings
                      </label>

                      <span
                        className={`text-xs font-bold ${
                          customIsValid
                            ? 'text-green-400'
                            : !customIsPerfectSquare && customCount > 0
                              ? 'text-red-400'
                              : 'text-gray-500'
                        }`}
                      >
                        {customCount} happenings
                      </span>

                    </div>

                    <textarea
                      value={customText}
                      onChange={(event) => {
                        setCustomText(
                          event.target.value
                        )
                        setCreateError('')
                      }}
                      rows={10}
                      maxLength={3000}
                      placeholder={`Someone starts dancing
Someone spills a drink
Someone arrives late
Someone tells a story
...`}
                      className="w-full resize-none rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm leading-relaxed text-white outline-none transition placeholder:text-gray-700 focus:border-green-500 focus:ring-2 focus:ring-green-500/10"
                    />

                    <div className="mt-2 flex items-center justify-between gap-3">

                      <p className="text-xs leading-relaxed text-gray-600">
                        Enter one happening per line. Use a perfect-square total (9, 16, 25, 36, etc.). Each one should be unique.
                      </p>

                      <button
                        type="button"
                        onClick={useDefaultHappenings}
                        className="shrink-0 rounded-lg bg-gray-800 px-3 py-2 text-xs font-bold text-gray-400 transition hover:bg-gray-700 hover:text-white"
                      >
                        Use defaults
                      </button>

                    </div>

                    {duplicateCount > 0 && (
                      <div className="mt-3 rounded-xl border border-yellow-900 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-400">
                        ⚠️ You have{' '}
                        {duplicateCount}{' '}
                        duplicate{' '}
                        {duplicateCount === 1
                          ? 'happening'
                          : 'happenings'}.
                      </div>
                    )}

                    {customIsPerfectSquare &&
                      duplicateCount === 0 && (
                        <div className="mt-3 rounded-xl border border-green-900 bg-green-950/30 px-3 py-2 text-xs font-semibold text-green-400">
                          ✓ Your {customCount}-square Bingo is ready ({customBoardSize} × {customBoardSize}).
                        </div>
                      )}

                  </div>
                )}

                {/* PREVIEW */}
                {gameMode === 'custom' &&
                  customCount > 0 && (
                    <div className="mb-5">

                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-600">
                        Preview
                      </p>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">

                        {customHappenings
                          .slice(0, 6)
                          .map(
                            (
                              happening,
                              index
                            ) => (
                              <div
                                key={`${happening}-${index}`}
                                className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-xs leading-relaxed text-gray-400"
                              >
                                {happening}
                              </div>
                            )
                          )}

                      </div>

                      {customCount > 6 && (
                        <p className="mt-2 text-center text-xs text-gray-700">
                          +{' '}
                          {customCount - 6}{' '}
                          more
                        </p>
                      )}

                    </div>
                  )}

                <button
                  type="button"
                  onClick={createGame}
                  disabled={
                    creating ||
                    (gameMode ===
                      'custom' &&
                      !customIsValid)
                  }
                  className="w-full rounded-xl bg-green-500 px-5 py-3.5 font-black text-gray-950 transition hover:bg-green-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {creating
                    ? 'Creating game...'
                    : gameMode ===
                        'custom'
                      ? 'Create Custom Game →'
                      : 'Create Game →'}
                </button>

                {createError && (
                  <div className="mt-4 rounded-xl border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
                    {createError}
                  </div>
                )}

              </section>

              {/* JOIN */}
              <section className="rounded-3xl border border-gray-800 bg-gray-900/90 p-6 shadow-xl backdrop-blur sm:p-8">

                <div className="mb-7 flex items-start justify-between">

                  <div>
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-2xl">
                      🚀
                    </div>

                    <h3 className="text-2xl font-bold">
                      Join a game
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      Enter the code from your host.
                    </p>
                  </div>

                  <span className="rounded-full bg-blue-500/10 px-3 py-1 text-[10px] font-black tracking-wider text-blue-400">
                    PLAYER
                  </span>

                </div>

                <label className="mb-2 block text-sm font-semibold text-gray-300">
                  Game code
                </label>

                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) =>
                    setJoinCode(
                      event.target.value
                        .toUpperCase()
                        .replace(
                          /[^A-Z0-9]/g,
                          ''
                        )
                        .slice(0, 5)
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      'Enter'
                    ) {
                      joinGame()
                    }
                  }}
                  placeholder="ABCDE"
                  maxLength={5}
                  className="mb-4 w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-4 text-center font-mono text-3xl font-black tracking-[0.35em] text-white outline-none transition placeholder:text-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                />

                <button
                  type="button"
                  onClick={joinGame}
                  disabled={joining}
                  className="w-full rounded-xl bg-blue-500 px-5 py-3.5 font-bold text-white transition hover:bg-blue-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {joining
                    ? 'Joining game...'
                    : 'Join Game →'}
                </button>

                {joinError && (
                  <div className="mt-4 rounded-xl border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
                    {joinError}
                  </div>
                )}

                <div className="mt-8 border-t border-gray-800 pt-6">

                  <p className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-600">
                    How joining works
                  </p>

                  <div className="space-y-3 text-sm text-gray-500">

                    <div className="flex gap-3">
                      <span>1️⃣</span>
                      <span>
                        Get the five-character
                        code from your host.
                      </span>
                    </div>

                    <div className="flex gap-3">
                      <span>2️⃣</span>
                      <span>
                        Enter it above and
                        join the lobby.
                      </span>
                    </div>

                    <div className="flex gap-3">
                      <span>3️⃣</span>
                      <span>
                        Everyone gets their
                        own randomized board.
                      </span>
                    </div>

                  </div>

                </div>

              </section>

            </div>
            )}

            {homeTab === 'play' && (<>
            {/* HOW IT WORKS */}
            <section className="mt-14">

              <div className="mb-6 text-center">

                <p className="text-xs font-bold uppercase tracking-widest text-gray-600">
                  Simple rules
                </p>

                <h3 className="mt-2 text-2xl font-bold">
                  How it works
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  Create it. Share it. Get Bingo.
                </p>

              </div>

              <div className="grid gap-3 sm:grid-cols-3">

                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                  <div className="mb-4 text-2xl">
                    🎮
                  </div>

                  <h4 className="font-bold">
                    Create your game
                  </h4>

                  <p className="mt-2 text-sm leading-relaxed text-gray-500">
                    Use the default party
                    happenings or create your
                    own custom list.
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                  <div className="mb-4 text-2xl">
                    🔗
                  </div>

                  <h4 className="font-bold">
                    Invite everyone
                  </h4>

                  <p className="mt-2 text-sm leading-relaxed text-gray-500">
                    Share the game link or
                    five-character code and
                    wait for everyone to join.
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
                  <div className="mb-4 text-2xl">
                    🏆
                  </div>

                  <h4 className="font-bold">
                    Get Bingo
                  </h4>

                  <p className="mt-2 text-sm leading-relaxed text-gray-500">
                    Complete a row, column or
                    diagonal before everyone
                    else.
                  </p>
                </div>

              </div>

            </section>
            </>)}
          </>
        )}

        <footer className="mt-14 pb-4 text-center text-xs text-gray-700">
          Multiplayer Bingo · Have fun 🎉
        </footer>

      </div>
    </main>
  )
}