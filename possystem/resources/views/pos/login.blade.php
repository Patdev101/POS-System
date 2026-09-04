<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Cashier Login</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
</head>
<body class="login-body">
    <div class="login-panel">
        <span class="login-eyebrow">CASHIER</span>
        <h1>{{ config('app.name') }}</h1>
        <p class="login-subtitle">Sign in to access your POS Dashboard</p>

        <form id="login-form">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required autofocus placeholder="you@store.com">

            <label for="password">Password</label>
            <input type="password" id="password" name="password" required placeholder="••••••••">

            <div id="login-error" class="error-banner" hidden></div>

            <button type="submit">Sign In</button>
        </form>

        <p class="login-subtitle" style="margin-top: 16px;">
            Forgot your password? Please contact an administrator.
        </p>
    </div>

    <script src="/pos-assets/app.js?v={{ filemtime(public_path('pos-assets/app.js')) }}"></script>
    <script>Pos.initLoginPage();</script>
</body>
</html>
