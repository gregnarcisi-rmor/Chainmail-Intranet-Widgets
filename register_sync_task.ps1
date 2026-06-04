# PowerShell Script to register local Windows Scheduled Task for Chainmail Intranet EOD Sync
$NodePath = "C:\Program Files\nodejs\node.exe"
$ScriptPath = "c:\Users\greg_\OneDrive\Documents\Antigravity Save Folder\Chainmail-Intranet-Widgets\eod_sync.js"
$WorkingDir = "c:\Users\greg_\OneDrive\Documents\Antigravity Save Folder\Chainmail-Intranet-Widgets"

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument $ScriptPath -WorkingDirectory $WorkingDir
$Trigger = New-ScheduledTaskTrigger -Daily -At 5:00PM
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Register-ScheduledTask -TaskName "Chainmail_Intranet_EOD_Sync" -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
    Write-Host "SUCCESS: Windows Scheduled Task 'Chainmail_Intranet_EOD_Sync' has been registered."
    Write-Host "The script will run daily at 5:00 PM to pull Google Sheets spends and JIRA board updates."
} catch {
    Write-Warning "Failed to register Scheduled Task directly. This may require administrator permissions."
    Write-Host "To run this task manually or register it, open PowerShell as Administrator and run:"
    Write-Host "Register-ScheduledTask -TaskName 'Chainmail_Intranet_EOD_Sync' -Action (New-ScheduledTaskAction -Execute '$NodePath' -Argument '$ScriptPath' -WorkingDirectory '$WorkingDir') -Trigger (New-ScheduledTaskTrigger -Daily -At 5:00PM) -Force"
}
