'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Happening = {
  id: string
  text: string
  position: number
}

export default function GamePage() {
  const params = useParams()
  const gameId = params.gameId as string

  const [happenings, setHappenings] = useState<Happening[]>([])
  const [board, setBoard] = useState<string[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function loadGame() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return
      }

      // Load happenings
      const { data: happeningsData } = await supabase
        .from('happenings')
        .select('*')
        .eq('game_id', gameId)
        .order('position')

      // Load player's board
      const { data: playerData } = await supabase
        .from('game_players')
        .select('board')
        .eq('game_id', gameId)
        .eq('user_id', user.id)
        .single()

      // Load already checked happenings
      const { data: checkedData } = await supabase
        .from('checked_happenings')
        .select('happening_id')
        .eq('game_id', gameId)

      if (happeningsData) {
        setHappenings(happeningsData)
      }

      if (playerData) {
        setBoard(playerData.board)
      }

      if (checkedData) {
        setChecked(
          new Set(
            checkedData.map((item) => item.happening_id)
          )
        )
      }

      setLoading(false)
    }

    loadGame()
  }, [gameId])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        Loading...
      </main>
    )
  }

  const happeningsById = new Map(
    happenings.map((happening) => [
      happening.id,
      happening,
    ])
  )

  return (
    <main className="min-h-screen p-4">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-8 text-center text-3xl font-bold">
          🎉 Bingo
        </h1>

        <div className="grid grid-cols-5 gap-2">
          {board.map((happeningId) => {
            const happening = happeningsById.get(happeningId)

            if (!happening) {
              return null
            }

            const isChecked = checked.has(happening.id)

            return (
              <button
                key={happening.id}
                className={`aspect-square rounded-lg border p-2 text-sm font-medium transition ${
                  isChecked
                    ? 'bg-green-500 text-white'
                    : 'bg-white hover:bg-gray-100'
                }`}
              >
                {happening.text}
              </button>
            )
          })}
        </div>
      </div>
    </main>
  )
}