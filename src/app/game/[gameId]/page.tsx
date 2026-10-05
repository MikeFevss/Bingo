'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { createClient } from '@/lib/supabase/client'

type Happening = {
  id: string
  text: string
  position: number
}

type Player = {
  id: string
  user_id: string
  display_name: string | null
  board: string[]
}

type Activity = {
  id: string
  user_id: string | null
  type: string
  message: string
  happening_id: string | null
  created_at: string
}

type Game = {
  id: string
  code: string
  name: string
  created_by: string
  status: string
  winner_id: string | null
  locked: boolean
  started_at: string | null
  finished_at: string | null
}

type Line = number[]

const supabase = createClient()

const WINNING_LINES: Line[] = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],

  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],

  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
]

function getBestLineProgress(
  board: string[],
  checkedIds: Set<string>
) {
  let bestLine: Line = []
  let bestCount = 0

  for (const line of WINNING_LINES) {
    const count = line.filter((index) =>
      checkedIds.has(board[index])
    ).length

    if (count > bestCount) {
      bestCount = count
      bestLine = line
    }
  }

  return {
    count: bestCount,
    line: bestLine,
  }
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString(
    [],
    {
      hour: '2-digit',
      minute: '2-digit',
    }
  )
}

export default function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const [routeGameCode, setRouteGameCode] =
    useState<string | null>(null)

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null)

  const [userName, setUserName] =
    useState<string>('Player')

  const [game, setGame] =
    useState<Game | null>(null)

  const [happenings, setHappenings] =
    useState<Happening[]>([])

  const [players, setPlayers] =
    useState<Player[]>([])

  const [checkedIds, setCheckedIds] =
    useState<Set<string>>(new Set())

  const [activities, setActivities] =
    useState<Activity[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [authRequired, setAuthRequired] =
    useState(false)

  const [joiningGame, setJoiningGame] =
    useState(false)

  const [joinError, setJoinError] =
    useState<string | null>(null)

  const [copySuccess, setCopySuccess] =
    useState(false)

  const [winningLine, setWinningLine] =
    useState<Line>([])

  const victoryClaimInProgress =
    useRef(false)

  const activityIds =
    useRef<Set<string>>(new Set())

  useEffect(() => {
    params.then((value) => {
      setRouteGameCode(
        value.gameId.toUpperCase()
      )
    })
  }, [params])

  const currentPlayer = useMemo(() => {
    if (!currentUserId) {
      return null
    }

    return (
      players.find(
        (player) =>
          player.user_id === currentUserId
      ) ?? null
    )
  }, [players, currentUserId])

  const winnerPlayer = useMemo(() => {
    if (!game?.winner_id) {
      return null
    }

    return (
      players.find(
        (player) =>
          player.user_id === game.winner_id
      ) ?? null
    )
  }, [game?.winner_id, players])

  const winnerProgress = useMemo(() => {
    if (!winnerPlayer) {
      return null
    }

    return getBestLineProgress(
      winnerPlayer.board,
      checkedIds
    )
  }, [winnerPlayer, checkedIds])

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const progressA =
        getBestLineProgress(
          a.board,
          checkedIds
        ).count

      const progressB =
        getBestLineProgress(
          b.board,
          checkedIds
        ).count

      if (progressA !== progressB) {
        return progressB - progressA
      }

      if (
        a.user_id === currentUserId &&
        b.user_id !== currentUserId
      ) {
        return -1
      }

      if (
        b.user_id === currentUserId &&
        a.user_id !== currentUserId
      ) {
        return 1
      }

      return (
        (a.display_name ?? '').localeCompare(
          b.display_name ?? ''
        )
      )
    })
  }, [players, checkedIds, currentUserId])

  const signInToJoin = async () => {
    try {
      setJoinError(null)

      const nextPath =
        window.location.pathname

      const {
        error: authError,
      } =
        await supabase.auth.signInWithOAuth(
          {
            provider: 'google',
            options: {
              redirectTo:
                `${window.location.origin}/auth/callback?next=${encodeURIComponent(
                  nextPath
                )}`,
            },
          }
        )

      if (authError) {
        console.error(
          'Authentication error:',
          authError
        )

        setJoinError(
          'Unable to start Google authentication.'
        )
      }
    } catch (err) {
      console.error(
        'Authentication error:',
        err
      )

      setJoinError(
        'Unable to start Google authentication.'
      )
    }
  }

  const joinGameAutomatically =
    useCallback(
      async (
        gameData: Game,
        userId: string,
        displayName: string
      ) => {
        setJoiningGame(true)
        setJoinError(null)

        try {
          const {
            data: existingPlayer,
            error: existingError,
          } = await supabase
            .from('game_players')
            .select(
              'id, user_id, display_name, board'
            )
            .eq(
              'game_id',
              gameData.id
            )
            .eq(
              'user_id',
              userId
            )
            .maybeSingle()

          if (existingError) {
            throw existingError
          }

          // Already joined this game.
          if (existingPlayer) {
            return true
          }

          // Locked games cannot accept new players.
          if (gameData.locked) {
            setJoinError(
              'This game is locked. You can no longer join it.'
            )

            return false
          }

          // Finished games cannot accept new players.
          if (
            gameData.status ===
            'finished'
          ) {
            setJoinError(
              'This game has already finished.'
            )

            return false
          }

          /*
           * Get the 25 happenings belonging to
           * this specific game.
           */
          const {
            data: gameHappenings,
            error:
              happeningsError,
          } = await supabase
            .from('happenings')
            .select(
              'id, position'
            )
            .eq(
              'game_id',
              gameData.id
            )
            .order('position', {
              ascending: true,
            })

          if (happeningsError) {
            throw happeningsError
          }

          if (
            !gameHappenings ||
            gameHappenings.length !== 25
          ) {
            throw new Error(
              'This game does not have a valid 25-square board.'
            )
          }

          /*
           * Create a shuffled board from the
           * game's 25 happening IDs.
           */
          const board =
            gameHappenings.map(
              (item) => item.id
            )

          // Fisher-Yates shuffle
          for (
            let i =
              board.length - 1;
            i > 0;
            i--
          ) {
            const j =
              Math.floor(
                Math.random() *
                  (i + 1)
              )

            ;[
              board[i],
              board[j],
            ] = [
              board[j],
              board[i],
            ]
          }

          const {
            error: insertError,
          } = await supabase
            .from('game_players')
            .insert({
              game_id:
                gameData.id,
              user_id:
                userId,
              display_name:
                displayName,
              board,
            })

          if (insertError) {
            /*
             * If two requests happen at almost
             * exactly the same time, check whether
             * the player was actually created by
             * the other request.
             */
            console.error(
              'Automatic join error:',
              insertError
            )

            const {
              data: playerAfterError,
            } = await supabase
              .from('game_players')
              .select('id')
              .eq(
                'game_id',
                gameData.id
              )
              .eq(
                'user_id',
                userId
              )
              .maybeSingle()

            if (playerAfterError) {
              return true
            }

            throw insertError
          }

          await supabase
            .from('game_activity')
            .insert({
              game_id:
                gameData.id,
              user_id: userId,
              type: 'join',
              message:
                `👋 ${displayName} joined the game`,
            })

          return true
        } catch (err) {
          console.error(
            'Automatic join error:',
            err
          )

          setJoinError(
            err instanceof Error
              ? err.message
              : 'Unable to join this game.'
          )

          return false
        } finally {
          setJoiningGame(false)
        }
      },
      []
    )

  const loadGame = useCallback(
    async () => {
      if (!routeGameCode) {
        return
      }

      try {
        setLoading(true)
        setError(null)
        setJoinError(null)

        const {
          data: {
            user,
          },
        } = await supabase.auth.getUser()

        /*
         * If the person opened an invite link
         * while logged out, show the login screen
         * instead of throwing an error.
         */
        if (!user) {
          setAuthRequired(true)
          setLoading(false)
          return
        }

        setAuthRequired(false)
        setCurrentUserId(user.id)

        const metadataName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split('@')[0] ||
          'Player'

        setUserName(metadataName)

        /*
         * The URL contains the game CODE,
         * not the database UUID.
         */
        const {
          data: gameData,
          error: gameError,
        } = await supabase
          .from('games')
          .select(
            `
              id,
              code,
              name,
              created_by,
              status,
              winner_id,
              locked,
              started_at,
              finished_at
            `
          )
          .eq(
            'code',
            routeGameCode.toUpperCase()
          )
          .single()

        if (gameError) {
          console.error(
            'Game loading error:',
            gameError
          )

          throw new Error(
            'Game not found.'
          )
        }

        /*
         * Automatically join the player if they
         * aren't already in this game.
         */
        const joined =
          await joinGameAutomatically(
            gameData,
            user.id,
            metadataName
          )

        setGame(gameData)

        if (!joined) {
          setLoading(false)
          return
        }

        /*
         * Once the player is guaranteed to be
         * part of the game, load all game data.
         */
        const [
          happeningsResult,
          playersResult,
          checkedResult,
          activityResult,
        ] = await Promise.all([
          supabase
            .from('happenings')
            .select(
              'id, text, position'
            )
            .eq(
              'game_id',
              gameData.id
            )
            .order('position', {
              ascending: true,
            }),

          supabase
            .from('game_players')
            .select(
              `
                id,
                user_id,
                display_name,
                board
              `
            )
            .eq(
              'game_id',
              gameData.id
            )
            .order('joined_at', {
              ascending: true,
            }),

          supabase
            .from('checked_happenings')
            .select(
              'happening_id'
            )
            .eq(
              'game_id',
              gameData.id
            ),

          supabase
            .from('game_activity')
            .select(
              `
                id,
                user_id,
                type,
                message,
                happening_id,
                created_at
              `
            )
            .eq(
              'game_id',
              gameData.id
            )
            .order('created_at', {
              ascending: true,
            }),
        ])

        if (happeningsResult.error) {
          throw happeningsResult.error
        }

        if (playersResult.error) {
          throw playersResult.error
        }

        if (checkedResult.error) {
          throw checkedResult.error
        }

        if (activityResult.error) {
          throw activityResult.error
        }

        setHappenings(
          happeningsResult.data ?? []
        )

        setPlayers(
          (playersResult.data ?? []).map(
            (player) => ({
              ...player,
              board: Array.isArray(
                player.board
              )
                ? player.board
                : [],
            })
          )
        )

        setCheckedIds(
          new Set(
            (
              checkedResult.data ?? []
            ).map(
              (item) =>
                item.happening_id
            )
          )
        )

        const loadedActivities =
          activityResult.data ?? []

        setActivities(
          loadedActivities
        )

        activityIds.current =
          new Set(
            loadedActivities.map(
              (activity) =>
                activity.id
            )
          )
      } catch (err) {
        console.error(
          'Game loading error:',
          err
        )

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load the game.'
        )
      } finally {
        setLoading(false)
      }
    },
    [
      routeGameCode,
      joinGameAutomatically,
    ]
  )

  useEffect(() => {
    if (!routeGameCode) {
      return
    }

    loadGame()
  }, [routeGameCode, loadGame])

  useEffect(() => {
    if (!game?.id) {
      return
    }

    const gameId = game.id

    const channel = supabase
      .channel(`game-${gameId}`)

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          if (
            payload.eventType ===
              'UPDATE' &&
            payload.new
          ) {
            setGame(
              payload.new as Game
            )
          }
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'checked_happenings',
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const happeningId =
            payload.new
              ?.happening_id

          if (!happeningId) {
            return
          }

          setCheckedIds(
            (previous) => {
              const next =
                new Set(previous)

              next.add(happeningId)

              return next
            }
          )
        }
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_players',
          filter: `game_id=eq.${gameId}`,
        },
        () => {
          loadGame()
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_activity',
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const activity =
            payload.new as Activity

          if (
            !activity?.id ||
            activityIds.current.has(
              activity.id
            )
          ) {
            return
          }

          activityIds.current.add(
            activity.id
          )

          setActivities(
            (previous) => [
              ...previous,
              activity,
            ]
          )
        }
      )

      .subscribe((status) => {
        if (
          status ===
          'CHANNEL_ERROR'
        ) {
          console.error(
            'Realtime channel error.'
          )
        }
      })

    return () => {
      supabase.removeChannel(
        channel
      )
    }
  }, [game?.id, loadGame])

  const addActivity = useCallback(
    async (
      type: string,
      message: string,
      happeningId?: string
    ) => {
      if (
        !game?.id ||
        !currentUserId
      ) {
        return
      }

      const {
        data,
        error: activityError,
      } = await supabase
        .from('game_activity')
        .insert({
          game_id: game.id,
          user_id: currentUserId,
          type,
          message,
          happening_id:
            happeningId ?? null,
        })
        .select()
        .single()

      if (activityError) {
        console.error(
          'Activity insert error:',
          activityError
        )

        return
      }

      if (
        data &&
        !activityIds.current.has(
          data.id
        )
      ) {
        activityIds.current.add(
          data.id
        )

        setActivities(
          (previous) => [
            ...previous,
            data as Activity,
          ]
        )
      }
    },
    [game?.id, currentUserId]
  )

  const startGame = async () => {
    if (
      !game ||
      !currentUserId ||
      game.created_by !==
        currentUserId
    ) {
      return
    }

    if (game.locked) {
      return
    }

    const { error: updateError } =
      await supabase
        .from('games')
        .update({
          status: 'active',
          started_at:
            new Date().toISOString(),
        })
        .eq('id', game.id)
        .eq(
          'created_by',
          currentUserId
        )

    if (updateError) {
      console.error(
        'Start game error:',
        updateError
      )

      return
    }

    await addActivity(
      'start',
      '🎮 The game has started!'
    )

    await loadGame()
  }

  const toggleLock = async () => {
    if (
      !game ||
      !currentUserId ||
      game.created_by !==
        currentUserId
    ) {
      return
    }

    const newLocked =
      !game.locked

    const { error: updateError } =
      await supabase
        .from('games')
        .update({
          locked: newLocked,
        })
        .eq('id', game.id)
        .eq(
          'created_by',
          currentUserId
        )

    if (updateError) {
      console.error(
        'Lock update error:',
        updateError
      )

      return
    }

    await addActivity(
      'lock',
      newLocked
        ? '🔒 The game has been locked.'
        : '🔓 The game has been unlocked.'
    )

    await loadGame()
  }

  const checkHappening = async (
    happeningId: string
  ) => {
    if (
      !game ||
      game.status !== 'active' ||
      !currentPlayer
    ) {
      return
    }

    if (
      checkedIds.has(happeningId)
    ) {
      return
    }

    const {
      error: insertError,
    } = await supabase
      .from('checked_happenings')
      .insert({
        game_id: game.id,
        happening_id:
          happeningId,
        checked_by:
          currentUserId,
      })

    if (insertError) {
      console.error(
        'Check happening error:',
        insertError
      )

      return
    }

    const happening =
      happenings.find(
        (item) =>
          item.id ===
          happeningId
      )

    setCheckedIds(
      (previous) => {
        const next =
          new Set(previous)

        next.add(happeningId)

        return next
      }
    )

    if (happening) {
      const playerName =
        currentPlayer.display_name ||
        userName ||
        'Player'

      await addActivity(
        'check',
        `☑️ ${playerName} checked "${happening.text}"`,
        happeningId
      )
    }
  }

  useEffect(() => {
    if (
      !game ||
      game.status !== 'active' ||
      !currentPlayer ||
      !currentUserId
    ) {
      return
    }

    if (game.winner_id) {
      return
    }

    if (
      victoryClaimInProgress.current
    ) {
      return
    }

    const progress =
      getBestLineProgress(
        currentPlayer.board,
        checkedIds
      )

    if (progress.count !== 5) {
      return
    }

    victoryClaimInProgress.current =
      true

    async function claimVictory() {
      try {
        const {
          data,
          error: rpcError,
        } = await supabase.rpc(
          'claim_game_victory',
          {
            p_game_id:
              game!.id,
          }
        )

        if (rpcError) {
          console.error(
            'Automatic victory claim error:',
            rpcError
          )

          return
        }

        if (data === true) {
          setWinningLine(
            progress.line
          )

          const winnerName =
            currentPlayer!.display_name ||
            userName ||
            'Player'

          await addActivity(
            'winner',
            `🏆 ${winnerName} got BINGO!`
          )

          await loadGame()
        }
      } catch (err) {
        console.error(
          'Victory claim error:',
          err
        )
      } finally {
        victoryClaimInProgress.current =
          false
      }
    }

    claimVictory()
  }, [
    checkedIds,
    game,
    currentPlayer,
    currentUserId,
    userName,
    addActivity,
    loadGame,
  ])

  const copyGameLink =
    async () => {
      try {
        await navigator.clipboard.writeText(
          window.location.href
        )

        setCopySuccess(true)

        window.setTimeout(() => {
          setCopySuccess(false)
        }, 2000)
      } catch (err) {
        console.error(
          'Copy link error:',
          err
        )
      }
    }

  const playAgain = async () => {
    if (
      !game ||
      !currentUserId ||
      game.created_by !==
        currentUserId
    ) {
      return
    }

    try {
      const {
        error: checkedError,
      } = await supabase
        .from('checked_happenings')
        .delete()
        .eq(
          'game_id',
          game.id
        )

      if (checkedError) {
        console.error(
          'Reset checked happenings error:',
          checkedError
        )

        return
      }

      const {
        error: gameError,
      } = await supabase
        .from('games')
        .update({
          status: 'waiting',
          winner_id: null,
          started_at: null,
          finished_at: null,
        })
        .eq('id', game.id)
        .eq(
          'created_by',
          currentUserId
        )

      if (gameError) {
        console.error(
          'Reset game error:',
          gameError
        )

        return
      }

      setCheckedIds(
        new Set()
      )

      setWinningLine([])

      await addActivity(
        'restart',
        '🔄 The game has been reset.'
      )

      await loadGame()
    } catch (err) {
      console.error(
        'Play again error:',
        err
      )
    }
  }

  /*
   * AUTHENTICATION SCREEN
   *
   * This is shown when someone opens an invite
   * link without being signed in.
   */
  if (authRequired) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-xl">
            <div className="mb-4 text-5xl">
              🎲
            </div>

            <h1 className="text-2xl font-black">
              Join Bingo game
            </h1>

            <p className="mt-3 text-sm text-slate-400">
              Sign in with Google to join this
              game.
            </p>

            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-slate-500">
                Game code
              </div>

              <div className="mt-1 font-mono text-2xl font-black tracking-[0.2em]">
                {routeGameCode}
              </div>
            </div>

            {joinError && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {joinError}
              </div>
            )}

            <button
              onClick={
                signInToJoin
              }
              className="mt-6 w-full rounded-xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-slate-200"
            >
              Continue with Google
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (loading || joiningGame) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="text-center">
          <div className="mb-4 text-4xl">
            🎲
          </div>

          <p className="text-slate-300">
            {joiningGame
              ? 'Joining game...'
              : 'Loading game...'}
          </p>
        </div>
      </main>
    )
  }

  if (error || !game) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <div className="mb-4 text-4xl">
            😕
          </div>

          <h1 className="mb-2 text-xl font-bold">
            Unable to load game
          </h1>

          <p className="text-sm text-red-200">
            {error ??
              joinError ??
              'This game does not exist.'}
          </p>
        </div>
      </main>
    )
  }

  /*
   * If automatic joining failed because the
   * game is locked or finished, show a useful
   * message rather than an empty game page.
   */
  if (
    joinError &&
    !currentPlayer
  ) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <div className="mb-4 text-5xl">
              🔒
            </div>

            <h1 className="text-2xl font-black">
              Unable to join
            </h1>

            <p className="mt-3 text-sm text-slate-400">
              {joinError}
            </p>

            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-slate-500">
                Game
              </div>

              <div className="mt-1 font-bold">
                {game.name}
              </div>

              <div className="mt-1 font-mono text-sm text-slate-500">
                {game.code}
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const isHost =
    currentUserId ===
    game.created_by

  const checkedCount =
    checkedIds.size

  const totalHappenings =
    happenings.length

  const currentProgress =
    currentPlayer
      ? getBestLineProgress(
          currentPlayer.board,
          checkedIds
        )
      : null

  const isFinished =
    game.status === 'finished'

  const isWaiting =
    game.status === 'waiting'

  const isActive =
    game.status === 'active'

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* HEADER */}
        <header className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-400/20 bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300">
                  BINGO
                </span>

                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    isActive
                      ? 'border-green-400/20 bg-green-500/15 text-green-300'
                      : isFinished
                        ? 'border-yellow-400/20 bg-yellow-500/15 text-yellow-300'
                        : 'border-slate-600 bg-slate-700 text-slate-300'
                  }`}
                >
                  {isActive
                    ? 'LIVE'
                    : isFinished
                      ? 'FINISHED'
                      : 'WAITING'}
                </span>

                {game.locked && (
                  <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-300">
                    🔒 Locked
                  </span>
                )}
              </div>

              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                {game.name}
              </h1>

              <p className="mt-2 text-sm text-slate-400">
                {players.length}{' '}
                {players.length === 1
                  ? 'player'
                  : 'players'}{' '}
                · {checkedCount}/
                {totalHappenings}{' '}
                happenings checked
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Game code
                </div>

                <div className="font-mono text-lg font-bold tracking-[0.2em]">
                  {game.code}
                </div>
              </div>

              <button
                onClick={
                  copyGameLink
                }
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold transition hover:bg-slate-800"
              >
                {copySuccess
                  ? '✓ Copied'
                  : '🔗 Copy link'}
              </button>
            </div>
          </div>
        </header>

        {/* HOST CONTROLS */}
        {isHost && (
          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-bold">
                  Host controls
                </div>

                <div className="text-sm text-slate-400">
                  {isWaiting
                    ? 'Start the game when everyone is ready.'
                    : isActive
                      ? 'You can lock the game to prevent new players from joining.'
                      : 'The game has finished.'}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {isWaiting && (
                  <button
                    onClick={
                      startGame
                    }
                    disabled={
                      players.length <
                      1
                    }
                    className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ▶ Start game
                  </button>
                )}

                {isActive && (
                  <button
                    onClick={
                      toggleLock
                    }
                    className="rounded-xl border border-slate-600 bg-slate-800 px-5 py-3 text-sm font-bold transition hover:bg-slate-700"
                  >
                    {game.locked
                      ? '🔓 Unlock game'
                      : '🔒 Lock game'}
                  </button>
                )}

                {isFinished && (
                  <button
                    onClick={
                      playAgain
                    }
                    className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold transition hover:bg-blue-500"
                  >
                    🔄 Play again
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* GLOBAL PROGRESS */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-bold">
                Game progress
              </div>

              <div className="text-sm text-slate-400">
                Shared by everyone
              </div>
            </div>

            <div className="text-xl font-black">
              {checkedCount}/
              {totalHappenings}
            </div>
          </div>

          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{
                width:
                  totalHappenings > 0
                    ? `${Math.min(
                        100,
                        (checkedCount /
                          totalHappenings) *
                          100
                      )}%`
                    : '0%',
              }}
            />
          </div>
        </section>

        {/* WINNER BANNER */}
        {isFinished &&
          winnerPlayer && (
            <section className="mb-6 overflow-hidden rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-6 text-center">
              <div className="mb-3 text-5xl">
                🏆
              </div>

              <div className="text-sm font-semibold uppercase tracking-widest text-yellow-300">
                BINGO!
              </div>

              <h2 className="mt-1 text-3xl font-black text-yellow-100">
                {winnerPlayer.display_name ||
                  'Player'}{' '}
                wins!
              </h2>

              {winnerProgress && (
                <p className="mt-2 text-sm text-yellow-200/80">
                  Winning line:{' '}
                  {winnerProgress.count}/5
                </p>
              )}
            </section>
          )}

        {/* WAITING ROOM */}
        {isWaiting && (
          <section className="mb-6 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
            <div className="text-center">
              <div className="mb-3 text-4xl">
                🎲
              </div>

              <h2 className="text-xl font-bold">
                Waiting for the game to start
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                Share the game code or link with
                everyone you want to play with.
              </p>

              <div className="mt-5 flex justify-center">
                <div className="rounded-2xl border border-slate-700 bg-slate-950 px-8 py-4">
                  <div className="text-xs uppercase tracking-widest text-slate-500">
                    Join code
                  </div>

                  <div className="mt-1 font-mono text-4xl font-black tracking-[0.25em]">
                    {game.code}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* EVERYONE'S BOARDS */}
        <section className="mb-8">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">
                Everyone&apos;s boards
              </h2>

              <p className="text-sm text-slate-400">
                Watch everyone&apos;s progress and spot
                potential Bingos.
              </p>
            </div>

            {isActive && (
              <div className="text-xs text-slate-500">
                Boards update in real time
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {sortedPlayers.map(
              (player) => {
                const progress =
                  getBestLineProgress(
                    player.board,
                    checkedIds
                  )

                const isCurrent =
                  player.user_id ===
                  currentUserId

                const isWinner =
                  player.user_id ===
                  game.winner_id

                const highlightedLine =
                  isWinner &&
                  isFinished &&
                  winnerPlayer?.user_id ===
                    player.user_id
                    ? winnerProgress?.line ??
                      []
                    : progress.count >=
                        3
                      ? progress.line
                      : []

                const isOneAway =
                  progress.count === 4

                return (
                  <div
                    key={player.id}
                    className={`rounded-2xl border p-4 transition ${
                      isWinner
                        ? 'border-yellow-400/50 bg-yellow-500/5 shadow-lg shadow-yellow-500/5'
                        : isCurrent
                          ? 'border-blue-400/40 bg-blue-500/5'
                          : 'border-slate-800 bg-slate-900/70'
                    }`}
                  >
                    {/* PLAYER HEADER */}
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-bold">
                            {player.display_name ||
                              'Player'}
                          </h3>

                          {isCurrent && (
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-300">
                              You
                            </span>
                          )}

                          {player.user_id ===
                            game.created_by && (
                            <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                              Host
                            </span>
                          )}

                          {isWinner && (
                            <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-yellow-300">
                              🏆 Winner
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {progress.count}/5 on best line
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {isWinner ? (
                          <div className="text-sm font-black text-yellow-300">
                            BINGO!
                          </div>
                        ) : isOneAway ? (
                          <div className="text-sm font-black text-orange-300">
                            ONE AWAY!
                          </div>
                        ) : (
                          <div className="text-sm font-bold text-slate-400">
                            {progress.count}/5
                          </div>
                        )}
                      </div>
                    </div>

                    {/* PLAYER PROGRESS */}
                    <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isWinner
                            ? 'bg-yellow-400'
                            : isOneAway
                              ? 'bg-orange-400'
                              : 'bg-blue-500'
                        }`}
                        style={{
                          width: `${
                            (progress.count /
                              5) *
                            100
                          }%`,
                        }}
                      />
                    </div>

                    {/* BOARD */}
                    <div className="mx-auto grid w-full max-w-[560px] grid-cols-5 gap-1.5 sm:gap-2">
                      {player.board.map(
                        (
                          happeningId,
                          index
                        ) => {
                          const happening =
                            happenings.find(
                              (item) =>
                                item.id ===
                                happeningId
                            )

                          const checked =
                            checkedIds.has(
                              happeningId
                            )

                          const highlighted =
                            highlightedLine.includes(
                              index
                            )

                          const winningSquare =
                            isWinner &&
                            isFinished &&
                            winningLine.length >
                              0 &&
                            winningLine.includes(
                              index
                            )

                          const winnerDerivedSquare =
                            isWinner &&
                            isFinished &&
                            winningLine.length ===
                              0 &&
                            highlightedLine.includes(
                              index
                            )

                          let squareClass =
                            'border-slate-700 bg-slate-800/80 text-slate-200'

                          if (
                            winningSquare ||
                            winnerDerivedSquare
                          ) {
                            squareClass =
                              'border-yellow-300 bg-yellow-400 text-slate-950 shadow-md shadow-yellow-400/20'
                          } else if (
                            highlighted &&
                            progress.count ===
                              4
                          ) {
                            squareClass =
                              'border-orange-300 bg-orange-400/80 text-slate-950'
                          } else if (
                            highlighted &&
                            progress.count >=
                              3
                          ) {
                            squareClass =
                              'border-blue-300/70 bg-blue-400/20 text-blue-100'
                          } else if (
                            checked
                          ) {
                            squareClass =
                              'border-green-400/40 bg-green-500/20 text-green-100'
                          }

                          return (
                            <div
                              key={`${player.id}-${index}`}
                              className={`relative flex min-h-[62px] items-center justify-center rounded-lg border p-1.5 text-center transition sm:min-h-[76px] sm:p-2 ${squareClass}`}
                            >
                              {checked && (
                                <div className="absolute right-1 top-1 text-[9px] font-black opacity-80">
                                  ✓
                                </div>
                              )}

                              <span className="line-clamp-4 text-[9px] font-semibold leading-tight sm:text-[11px]">
                                {happening?.text ??
                                  happeningId}
                              </span>
                            </div>
                          )
                        }
                      )}
                    </div>

                    {/* BOARD STATUS */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
                        <span>
                          <span className="text-green-300">
                            ✓
                          </span>{' '}
                          Checked
                        </span>

                        {progress.count >=
                          3 && (
                          <span>
                            <span className="text-blue-300">
                              ■
                            </span>{' '}
                            Potential line
                          </span>
                        )}
                      </div>

                      {isOneAway &&
                        !isWinner && (
                          <span className="font-bold text-orange-300">
                            🔥 One more!
                          </span>
                        )}
                    </div>
                  </div>
                )
              }
            )}
          </div>

          {players.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
              No players yet.
            </div>
          )}
        </section>

        {/* MY BOARD */}
        {currentPlayer &&
          isActive && (
            <section className="mb-8 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black">
                    Your board
                  </h2>

                  <p className="text-sm text-slate-400">
                    Tap a happening to check it for
                    everyone.
                  </p>
                </div>

                {currentProgress && (
                  <div
                    className={`text-sm font-black ${
                      currentProgress.count ===
                      4
                        ? 'text-orange-300'
                        : currentProgress.count >=
                            3
                          ? 'text-blue-300'
                          : 'text-slate-400'
                    }`}
                  >
                    Best line:{' '}
                    {currentProgress.count}
                    /5
                    {currentProgress.count ===
                      4 &&
                      ' — ONE AWAY!'}
                  </div>
                )}
              </div>

              <div className="mx-auto grid w-full max-w-[700px] grid-cols-5 gap-1.5 sm:gap-2">
                {currentPlayer.board.map(
                  (
                    happeningId,
                    index
                  ) => {
                    const happening =
                      happenings.find(
                        (item) =>
                          item.id ===
                          happeningId
                      )

                    const checked =
                      checkedIds.has(
                        happeningId
                      )

                    const highlighted =
                      currentProgress?.line.includes(
                        index
                      ) ?? false

                    let buttonClass =
                      'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'

                    if (checked) {
                      buttonClass =
                        'border-green-400/40 bg-green-500/20 text-green-100'
                    }

                    if (
                      highlighted &&
                      currentProgress?.count ===
                        4 &&
                      !checked
                    ) {
                      buttonClass =
                        'border-orange-300 bg-orange-400/80 text-slate-950 hover:bg-orange-300'
                    }

                    return (
                      <button
                        key={happeningId}
                        type="button"
                        disabled={
                          checked
                        }
                        onClick={() =>
                          checkHappening(
                            happeningId
                          )
                        }
                        className={`relative flex min-h-[70px] items-center justify-center rounded-xl border p-2 text-center transition active:scale-95 sm:min-h-[88px] ${buttonClass} ${
                          checked
                            ? 'cursor-default'
                            : 'cursor-pointer'
                        }`}
                      >
                        {checked && (
                          <span className="absolute right-1.5 top-1.5 text-xs font-black text-green-300">
                            ✓
                          </span>
                        )}

                        <span className="text-[10px] font-bold leading-tight sm:text-xs">
                          {happening?.text ??
                            happeningId}
                        </span>
                      </button>
                    )
                  }
                )}
              </div>
            </section>
          )}

        {/* ACTIVITY */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="border-b border-slate-800 px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-black">
                  Activity
                </h2>

                <p className="text-xs text-slate-500">
                  Game history
                </p>
              </div>

              <span className="text-xs text-slate-600">
                {activities.length}{' '}
                {activities.length ===
                1
                  ? 'event'
                  : 'events'}
              </span>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {activities.length ===
            0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-500">
                No activity yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {[
                  ...activities,
                ]
                  .reverse()
                  .map(
                    (activity) => (
                      <div
                        key={
                          activity.id
                        }
                        className="flex gap-3 px-5 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-300">
                            {
                              activity.message
                            }
                          </div>

                          <div className="mt-1 text-[10px] text-slate-600">
                            {formatTime(
                              activity.created_at
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  )}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}