import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: Request
) {
  const { searchParams, origin } =
    new URL(request.url)

  const code =
    searchParams.get('code')

  const next =
    searchParams.get('next') || '/'

  if (code) {
    const supabase =
      await createClient()

    const { error } =
      await supabase.auth.exchangeCodeForSession(
        code
      )

    if (error) {
      console.error(
        'Auth callback error:',
        error
      )

      return NextResponse.redirect(
        `${origin}/?authError=callback`
      )
    }
  }

  // Only allow internal paths.
  // Prevents an external redirect from being
  // injected through the `next` parameter.
  const safeNext =
    next.startsWith('/') &&
    !next.startsWith('//')
      ? next
      : '/'

  return NextResponse.redirect(
    `${origin}${safeNext}`
  )
}