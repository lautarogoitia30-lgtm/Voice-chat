## Summary
- Fixed mute microphone button to actually mute mic for other participants (was using gain node that didn't stop sending to server)
- Fixed mute audio button (deafen) to properly stop receiving audio
- Added participants-list div to voice chat for showing who is in voice channels

## Testing
- 🎤 Mute mic: Other participants should no longer hear you
- 🔊 Mute audio: You should no longer hear other participants
- Voice participants should display in main chat area