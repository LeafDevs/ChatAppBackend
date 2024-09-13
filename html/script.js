const socket = io();

const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messages = document.getElementById('messages');
const activeUsers = document.getElementById('active-users');
const loginModal = document.getElementById('loginModal');
const loginButton = document.getElementById('loginButton');
const loginError = document.getElementById('loginError');
const fileUpload = document.getElementById('file-upload');
const fileUploadButton = document.getElementById('file-upload-button');
const uploadProgress = document.getElementById('upload-progress');
const uploadProgressBar = document.getElementById('upload-progress-bar');

let username = '';

// Check session on page load
checkSession();

async function checkSession() {
    try {
        const response = await fetch('/api/v1/users/session');
        if (response.ok) {
            const data = await response.json();
            if (data.username) {
                username = data.username;
                loginModal.style.display = 'none';
                socket.emit('user joined', username);
                updateUserProfilePicture();
            } else {
                loginModal.style.display = 'flex';
            }
        } else {
            loginModal.style.display = 'flex';
        }
    } catch (error) {
        console.error('Session check error:', error);
        loginModal.style.display = 'flex';
    }
}

loginButton.addEventListener('click', async () => {
    const loginUsername = document.getElementById('loginUsername').value;
    const loginPassword = document.getElementById('loginPassword').value;

    try {
        const response = await fetch('/api/v1/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username: loginUsername, password: loginPassword }),
        });

        if (response.ok) {
            username = loginUsername;
            loginModal.style.display = 'none';
            socket.emit('user joined', username);
            updateUserProfilePicture();
        } else {
            loginError.textContent = 'Invalid username or password';
        }
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = 'An error occurred. Please try again.';
    }
});

messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (messageInput.value) {
        sendMessage(messageInput.value);
        messageInput.value = '';
    }
});

fileUploadButton.addEventListener('click', () => {
    fileUpload.click();
});

fileUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 100 * 1024 * 1024) {
            alert('File size exceeds 100MB limit');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            uploadProgress.style.display = 'block';
            const response = await fetch('/api/v1/upload', {
                method: 'POST',
                body: formData,
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    uploadProgressBar.style.width = `${percentCompleted}%`;
                }
            });

            if (response.ok) {
                const data = await response.json();
                sendMessage(data.url);
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert('File upload failed');
        } finally {
            uploadProgress.style.display = 'none';
            uploadProgressBar.style.width = '0%';
        }
    }
});

function sendMessage(content) {
    socket.emit('chat message', { username, message: content });
}

let userProfilePicture = '';

async function fetchUserData(username) {
    try {
        const response = await fetch(`/api/v1/userdata/user/${username}`);
        if (response.ok) {
            let data = await response.json();
            return data.user;
        }
    } catch (error) {
        console.error('Error fetching user data:', error);
    }
    return { 
        username: username, 
        profilePicture: '',
        nickname: username
    };
}

async function updateUserProfilePicture() {
    const userData = await fetchUserData(username);
    userProfilePicture = userData.profilePicture;
    document.getElementById('profile-picture').src = userProfilePicture || '';
    document.getElementById('display-name').textContent = userData.nickname || username;
    document.getElementById('username').innerHTML = `<span class="dot"></span>@${username}`;
}

// Profile picture update modal
const modal = document.getElementById('profileModal');
const profilePicture = document.getElementById('profile-picture');
const closeBtn = document.getElementsByClassName('close')[0];
const updateBtn = document.getElementById('updateProfilePicture');
const profilePictureUrlInput = document.getElementById('profilePictureUrl');

profilePicture.addEventListener('click', () => {
    modal.style.display = 'block';
});

closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
});

updateBtn.addEventListener('click', async () => {
    const newUrl = profilePictureUrlInput.value.trim();
    if (newUrl) {
        userProfilePicture = newUrl;
        profilePicture.src = userProfilePicture;
        modal.style.display = 'none';
        
        // Update the user data on the server
        try {
            const response = await fetch('/api/v1/userdata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    profilePicture: newUrl
                }),
            });
            if (!response.ok) {
                throw new Error('Failed to update profile picture');
            }
        } catch (error) {
            console.error('Error updating profile picture:', error);
        }
    }
});

window.addEventListener('click', (event) => {
    if (event.target == modal) {
        modal.style.display = 'none';
    }
});

const userInfoModal = document.getElementById('userInfoModal');
const userInfoAvatar = document.getElementById('userInfoAvatar');
const userInfoName = document.getElementById('userInfoName');
const userInfoUsername = document.getElementById('userInfoUsername');

function showUserInfo(username) {
    fetchUserData(username).then(userData => {
        userInfoAvatar.src = userData.profilePicture;
        userInfoName.textContent = userData.nickname || username;
        userInfoUsername.textContent = `@${username}`;
        userInfoModal.style.display = 'block';
    });
}

// Close user info modal when clicking on the close button or outside the modal
userInfoModal.querySelector('.close').addEventListener('click', () => {
    userInfoModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target == userInfoModal) {
        userInfoModal.style.display = 'none';
    }
});

socket.on('chat message', async (data) => {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${data.username === username ? 'self' : ''}`;
    
    const userData = await fetchUserData(data.username);
    const avatarUrl = userData.profilePicture;
    
    // Convert URLs to clickable links
    const messageContent = data.message.replace(
        /(https?:\/\/[^\s]+)/g, 
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    
    messageElement.innerHTML = `
        <img class="message-avatar" src="${avatarUrl || ''}" alt="${data.username}'s avatar" onerror="this.src='https://via.placeholder.com/36?text=User'">
        <div class="message-content">
            <div class="message-username">${data.username === username ? 'You' : userData.nickname || data.username}</div>
            <div class="message-text">${messageContent}</div>
        </div>
    `;
    
    messageElement.querySelector('.message-avatar').addEventListener('click', () => {
        showUserInfo(data.username);
    });
    
    messages.appendChild(messageElement);
    messages.scrollTop = messages.scrollHeight;
});

async function updateActiveUsers(users) {
    activeUsers.innerHTML = '';
    for (const user of users) {
        const userData = await fetchUserData(user);
        const userElement = document.createElement('li');
        userElement.innerHTML = `
            <img src="${userData.profilePicture || 'https://via.placeholder.com/36?text=User'}" alt="${user}'s avatar" onerror="this.src='https://via.placeholder.com/36?text=User'">
            ${userData.nickname || user}
        `;
        userElement.addEventListener('click', () => showUserInfo(user));
        activeUsers.appendChild(userElement);
    }
}

socket.on('update users', (users) => {
    updateActiveUsers(users);
});

// Hamburger menu functionality
const hamburger = document.getElementById('hamburger');
const sidebar = document.getElementById('sidebar');

hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('active');
});

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) && e.target !== hamburger) {
        sidebar.classList.remove('active');
    }
});