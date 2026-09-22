<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Reset Password</title>
    <link rel="stylesheet" href="{{ asset('pos-assets/style.css') }}">
</head>
<body class="login-body">
    <div class="login-panel">
        <span class="login-eyebrow">CASHIER</span>
        <h1>Reset your password</h1>
        <p class="login-subtitle">Choose a new password for your account.</p>

        @if ($errors->any())
            <div class="error-banner">{{ $errors->first() }}</div>
        @endif

        <form method="POST" action="{{ route('password.update') }}" novalidate>
            @csrf
            <input type="hidden" name="token" value="{{ $token }}">

            <label for="email">Email</label>
            <input type="email" id="email" name="email" value="{{ old('email', $email) }}" required autofocus placeholder="you@store.com">
            <p class="field-error" id="email-error" hidden></p>

            <label for="password">New Password</label>
            <input type="password" id="password" name="password" required minlength="8" placeholder="••••••••">
            <p class="field-error" id="password-error" hidden></p>

            <label for="password_confirmation">Confirm New Password</label>
            <input type="password" id="password_confirmation" name="password_confirmation" required minlength="8" placeholder="••••••••">
            <p class="field-error" id="password_confirmation-error" hidden></p>

            <button type="submit" id="reset-submit">
                <span class="btn-spinner" hidden></span>
                <span class="btn-label">Reset Password</span>
            </button>
        </form>

        <p class="login-subtitle" style="margin-top: 16px;">
            <a href="{{ route('pos.login') }}">Back to sign in</a>
        </p>
    </div>

    <script>
        (function () {
            var form = document.querySelector('form');
            var emailInput = document.getElementById('email');
            var passwordInput = document.getElementById('password');
            var confirmInput = document.getElementById('password_confirmation');

            function messageFor(input) {
                if (input.validity.valueMissing) {
                    return input === emailInput ? 'Please enter your email address.' : 'Please enter a password.';
                }
                if (input.validity.typeMismatch && input === emailInput) {
                    return "Please include an '@' in the email address. '" + input.value + "' is missing an '@'.";
                }
                if (input.validity.tooShort) {
                    return 'Password must be at least 8 characters.';
                }
                if (input === confirmInput && passwordInput.value !== confirmInput.value) {
                    return 'Passwords do not match.';
                }
                return input.validationMessage || 'This field is invalid.';
            }

            function isValid(input) {
                if (input === confirmInput) {
                    return input.validity.valid && passwordInput.value === confirmInput.value;
                }
                return input.validity.valid;
            }

            function validateField(input) {
                var errorEl = document.getElementById(input.id + '-error');
                if (!errorEl) return true;

                if (isValid(input)) {
                    errorEl.hidden = true;
                    errorEl.textContent = '';
                    input.classList.remove('field-invalid');
                } else {
                    errorEl.textContent = messageFor(input);
                    errorEl.hidden = false;
                    input.classList.add('field-invalid');
                }

                return isValid(input);
            }

            [emailInput, passwordInput, confirmInput].forEach(function (input) {
                input.addEventListener('input', function () {
                    if (input.classList.contains('field-invalid')) validateField(input);
                });
                input.addEventListener('blur', function () { validateField(input); });
            });

            form.addEventListener('submit', function (e) {
                var allValid = [emailInput, passwordInput, confirmInput]
                    .map(validateField)
                    .every(Boolean);

                if (!allValid) {
                    e.preventDefault();
                    return;
                }

                var btn = document.getElementById('reset-submit');
                btn.disabled = true;
                btn.querySelector('.btn-spinner').hidden = false;
                btn.querySelector('.btn-label').textContent = 'Resetting…';
            });
        })();
    </script>
</body>
</html>
