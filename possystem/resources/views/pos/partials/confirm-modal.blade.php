<!-- CONFIRM MODAL (replaces window.confirm()/window.prompt() for destructive actions) -->
<div class="modal-overlay" id="confirm-modal-overlay" hidden>

    <div class="confirm-modal-box">

        <h3 id="confirm-modal-title">Are you sure?</h3>
        <p id="confirm-modal-message">This action cannot be undone.</p>

        <div class="form-group" id="confirm-modal-reason-group" hidden>
            <label for="confirm-modal-reason">Reason (optional)</label>
            <input type="text" id="confirm-modal-reason" maxlength="255" autocomplete="off">
        </div>

        <div class="confirm-modal-actions">
            <button type="button" class="btn-secondary-modal" id="confirm-modal-cancel">Cancel</button>
            <button type="button" class="btn-danger-modal" id="confirm-modal-confirm">Confirm</button>
        </div>

    </div>

</div>
