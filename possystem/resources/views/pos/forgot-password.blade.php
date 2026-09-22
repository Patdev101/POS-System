<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Forgot Password</title>
    <link rel="stylesheet" href="{{ asset('pos-assets/style.css') }}">
</head>
<body class="login-body">
    <div class="login-panel">
        <span class="login-eyebrow">CASHIER</span>
        <h1>Forgot your password?</h1>
        <p class="login-subtitle">
            Enter your account email and we'll send you a link to reset your password.
        </p>

        @if (session('status'))
            <div class="info-box" style="background:#ecfdf5;border-color:#a7f3d0;color:#065f46;">
                {{ session('status') }}
            </div>
        @endif

        @if ($errors->any())
            <div class="error-banner">{{ $errors->first() }}</div>
        @endif

        <form method="POST" action="{{ route('password.email') }}" novalidate>
            @csrf
            <label for="email">Email</label>
            <input type="email" id="email" name="email" value="{{ old('email') }}" required autofocus placeholder="you@store.com">
            <p class="field-error" id="email-error" hidden></p>

            <button type="submit" id="forgot-submit">
                <span class="btn-spinner" hidden></span>
                <span class="btn-label">Send Reset Link</span>
            </button>
        </form>

        <p class="login-subtitle" style="margin-top: 16px;">
            <a href="{{ route('pos.login') }}">Back to sign in</a>
        </p>

        <p class="login-subtitle" style="margin-top: 8px; font-size: 12px;">
            No luck? A manager can still reset your password directly from <strong>Manage Users</strong>.
        </p>
    </div>

    <script>
        (function () {
            var form = document.querySelector('form');
            var emailInput = document.getElementById('email');

            function validateField(input) {
                var errorEl = document.getElementById(input.id + '-error');
                if (!errorEl) return true;

                if (input.validity.valid) {
                    errorEl.hidden = true;
                    errorEl.textContent = '';
                    input.classList.remove('field-invalid');
                } else {
                    errorEl.textContent = input.validity.valueMissing
                        ? 'Please enter your email address.'
                        : "Please include an '@' in the email address. '" + input.value + "' is missing an '@'.";
                    errorEl.hidden = false;
                    input.classList.add('field-invalid');
                }

                return input.validity.valid;
            }

            emailInput.addEventListener('input', function () {
                if (emailInput.classList.contains('field-invalid')) validateField(emailInput);
            });
            emailInput.addEventListener('blur', function () { validateField(emailInput); });

            form.addEventListener('submit', function (e) {
                if (!validateField(emailInput)) {
                    e.preventDefault();
                    emailInput.focus();
                    return;
                }

                var btn = document.getElementById('forgot-submit');
                btn.disabled = true;
                btn.querySelector('.btn-spinner').hidden = false;
                btn.querySelector('.btn-label').textContent = 'Sending…';
            });
        })();
    </script>
</body>
</html>
