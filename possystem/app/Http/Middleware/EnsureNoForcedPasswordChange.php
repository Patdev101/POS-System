<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * When an admin resets a user's password with "require password change on
 * next login", the user is locked out of every other API endpoint until
 * they set their own new password via /api/account/password.
 */
class EnsureNoForcedPasswordChange
{
    private const ALLOWED_ROUTES = [
        'user',
        'account.email.update',
        'account.password.update',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            $user
            && $user->must_change_password
            && !$request->routeIs(...self::ALLOWED_ROUTES)
        ) {
            return response()->json([
                'message' => 'You must set a new password before continuing.',
                'must_change_password' => true,
            ], 423);
        }

        return $next($request);
    }
}
