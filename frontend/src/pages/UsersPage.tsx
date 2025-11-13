import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, handleApiError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { ShieldCheckIcon, UserIcon } from '@heroicons/react/24/outline';
import type { UpdateUserPayload, User } from '../types';

const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState<'admin' | 'user'>('user');
  
  const { data: users, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'users'],
    queryFn: dashboardApi.getUsers,
    enabled: currentUser?.role === 'admin',
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateUserPayload }) =>
      dashboardApi.updateUser(id, payload),
    onSuccess: (_data, variables) => {
      setActionError(null);
      setActionSuccess('User updated successfully.');
      if (editingUserId === variables.id) {
        setEditingUserId(null);
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (mutationError) => {
      setActionSuccess(null);
      setActionError(handleApiError(mutationError));
    }
  });

  const createUserMutation = useMutation({
    mutationFn: dashboardApi.createUser,
    onSuccess: () => {
      setCreateError(null);
      setCreateSuccess('User added successfully. They can now sign in with one of the configured providers.');
      setNewEmail('');
      setNewName('');
      setNewRole('user');
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (mutationError) => {
      setCreateSuccess(null);
      setCreateError(handleApiError(mutationError));
    }
  });

  const handleCreateUser = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateSuccess(null);
    setCreateError(null);
    setActionError(null);
    setActionSuccess(null);

    createUserMutation.mutate({
      email: newEmail.trim(),
      name: newName.trim(),
      role: newRole,
    });
  };

  const startEditingUser = (user: User) => {
    setEditingUserId(user.id);
    setEditingRole(user.role);
    setActionError(null);
    setActionSuccess(null);
  };

  const handleCancelEdit = () => {
    setEditingUserId(null);
  };

  const handleUpdateRole = (user: User) => {
    if (editingRole === user.role) {
      setEditingUserId(null);
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    updateUserMutation.mutate({ id: user.id, payload: { role: editingRole } });
  };

  const handleToggleActive = (user: User) => {
    setActionError(null);
    setActionSuccess(null);
    updateUserMutation.mutate({ id: user.id, payload: { active: !user.active } });
  };

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => dashboardApi.deleteUser(id),
    onSuccess: (_data, id) => {
      setActionError(null);
      setActionSuccess('User removed successfully.');
      if (editingUserId === id) {
        setEditingUserId(null);
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'users'] });
    },
    onError: (mutationError) => {
      setActionSuccess(null);
      setActionError(handleApiError(mutationError));
    }
  });

  const handleDeleteUser = (user: User) => {
    const confirm = window.confirm(`Remove ${user.email}? They will lose access until added again.`);
    if (!confirm) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    deleteUserMutation.mutate(user.id);
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center py-12">
          <ShieldCheckIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">
            You need administrator privileges to access user management.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600">Failed to load users</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="pb-5 border-b border-gray-200">
        <h1 className="text-3xl font-bold leading-6 text-gray-900">User Management</h1>
        <p className="mt-2 max-w-4xl text-sm text-gray-500">
          Manage user accounts and permissions
        </p>
      </div>

      <div className="mt-6">
        <div className="card p-6">
          <h3 className="text-lg font-medium text-gray-900">Add User</h3>
          <p className="mt-1 text-sm text-gray-500">
            Add an email address that should be allowed to sign in through Google, GitHub, or Microsoft.
          </p>

          <form className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4" onSubmit={handleCreateUser}>
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700" htmlFor="new-user-email">
                Email
              </label>
              <input
                id="new-user-email"
                type="email"
                required
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="user@example.com"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-sm font-medium text-gray-700" htmlFor="new-user-name">
                Display name (optional)
              </label>
              <input
                id="new-user-name"
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="Full name"
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-sm font-medium text-gray-700" htmlFor="new-user-role">
                Role
              </label>
              <select
                id="new-user-role"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as 'admin' | 'user')}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
              >
                <option value="user">User</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <div className="lg:col-span-4 flex flex-col sm:flex-row sm:items-center sm:gap-4">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
                disabled={createUserMutation.isPending}
              >
                {createUserMutation.isPending ? 'Adding…' : 'Add User'}
              </button>
              {createError && (
                <span className="mt-2 text-sm text-red-600 sm:mt-0">{createError}</span>
              )}
              {createSuccess && (
                <span className="mt-2 text-sm text-green-600 sm:mt-0">{createSuccess}</span>
              )}
            </div>
          </form>
        </div>
      </div>

      {(actionError || actionSuccess) && (
        <div className={`mt-6 rounded-md p-4 ${actionError ? 'bg-red-50' : 'bg-green-50'}`}>
          <p className={`text-sm ${actionError ? 'text-red-700' : 'text-green-700'}`}>
            {actionError || actionSuccess}
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UserIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-5">
              <div className="text-sm font-medium text-gray-500">Total Users</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900">
                {users?.length || 0}
              </div>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ShieldCheckIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-5">
              <div className="text-sm font-medium text-gray-500">Admins</div>
              <div className="mt-1 text-2xl font-semibold text-green-600">
                {users?.filter(u => u.role === 'admin').length || 0}
              </div>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UserIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div className="ml-5">
              <div className="text-sm font-medium text-gray-500">Regular Users</div>
              <div className="mt-1 text-2xl font-semibold text-gray-600">
                {users?.filter(u => u.role === 'user').length || 0}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="mt-8">
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">All Users</h3>
          </div>
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users?.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {user.avatar_url ? (
                          <img
                            className="h-8 w-8 rounded-full"
                            src={user.avatar_url}
                            alt={user.name}
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center">
                            <UserIcon className="h-5 w-5 text-gray-600" />
                          </div>
                        )}
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {user.name}
                            {user.id === currentUser?.id && (
                              <span className="ml-2 text-xs text-blue-600">(You)</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {user.role === 'admin' ? 'Administrator' : 'User'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {user.provider}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        user.active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {user.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {user.id !== currentUser?.id && (
                        <div className="flex justify-end items-center space-x-3">
                          {editingUserId === user.id ? (
                            <>
                              <select
                                value={editingRole}
                                onChange={(event) => setEditingRole(event.target.value as 'admin' | 'user')}
                                className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                                disabled={updateUserMutation.isPending}
                              >
                                <option value="user">User</option>
                                <option value="admin">Administrator</option>
                              </select>
                              <button
                                type="button"
                                className="text-blue-600 hover:text-blue-900 disabled:opacity-60"
                                onClick={() => handleUpdateRole(user)}
                                disabled={updateUserMutation.isPending}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="text-gray-500 hover:text-gray-700"
                                onClick={handleCancelEdit}
                                disabled={updateUserMutation.isPending}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="text-red-600 hover:text-red-900 disabled:opacity-60"
                                onClick={() => handleDeleteUser(user)}
                                disabled={deleteUserMutation.isPending}
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-blue-600 hover:text-blue-900 disabled:opacity-60"
                                onClick={() => startEditingUser(user)}
                                disabled={updateUserMutation.isPending}
                              >
                                Edit Role
                              </button>
                              <button
                                type="button"
                                className={`disabled:opacity-60 ${user.active ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'}`}
                                onClick={() => handleToggleActive(user)}
                                disabled={updateUserMutation.isPending}
                              >
                                {user.active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                type="button"
                                className="text-red-600 hover:text-red-900 disabled:opacity-60"
                                onClick={() => handleDeleteUser(user)}
                                disabled={deleteUserMutation.isPending}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )) || []}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* User Activity */}
      <div className="mt-8">
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Recent Activity</h3>
          </div>
          <div className="p-6">
            <div className="text-center text-gray-500">
              User activity tracking will be displayed here
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UsersPage;
