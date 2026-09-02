<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Cashier Login</title>
    <link rel="stylesheet" href="/pos-assets/style.css">
</head>
<body class="login-body">
    <div class="login-panel">
        <h1>{{ config('app.name') }}</h1>
        <p class="login-subtitle">Cashier Login</p>

        <form id="login-form">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required autofocus>

            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>

            <div id="login-error" class="error-banner" hidden></div>

            <button type="submit">Sign In</button>
        </form>
    </div>

    <script src="/pos-assets/app.js"></script>
    <script>Pos.initLoginPage();</script>
</body>
</html>
