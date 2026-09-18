<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\PosAuditLogger;
use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\View\View;

class PasswordResetController extends Controller
{
    public function create(): View
    {
        return view('pos.forgot-password');
    }

    public function sendResetLink(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
        ]);

        // The status code returned isn't checked or shown to the user —
        // the response is identical whether the email exists or not, so
        // this endpoint can't be used to enumerate valid cashier accounts.
        Password::broker('users')->sendResetLink($validated);

        return back()->with('status', 'If an account exists for that email, a password reset link has been sent.');
    }

    public function resetForm(Request $request, string $token): View
    {
        return view('pos.reset-password', [
            'token' => $token,
            'email' => $request->query('email', ''),
        ]);
    }

    public function reset(Request $request, PosAuditLogger $auditLogger): RedirectResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $status = Password::broker('users')->reset(
            $validated,
            function (User $user, string $password) use ($auditLogger) {
                $user->password = Hash::make($password);
                $user->must_change_password = false;
                $user->save();

                // A password reset via a (possibly leaked) email link should
                // invalidate any session that was active before it, same as
                // an admin-driven reset already does.
                $user->tokens()->delete();

                $auditLogger->passwordResetViaEmailLink($user);
            }
        );

        if ($status !== Password::PASSWORD_RESET) {
            return back()
                ->withErrors(['email' => __($status)])
                ->withInput($request->only('email'));
        }

        return redirect()->route('pos.login')->with('status', 'Your password has been reset. Please sign in.');
    }
}
