import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { ILike, In, Repository } from 'typeorm';
import {
  CreateEnderecoUsuarioDto,
  CreateUsuarioDto,
} from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { EnderecoUsuario } from './entities/endereco-usuario.entity';
import { Usuario } from './entities/usuario.entity';

type EnderecoUsuarioPublico = {
  id: string;
  usuario_id: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  created_at: Date;
  updated_at: Date;
};

type UsuarioSemSenha = Omit<Usuario, 'senha_hash'> & {
  endereco: EnderecoUsuarioPublico | null;
};

type EnderecoNormalizado = {
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
};

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    @InjectRepository(EnderecoUsuario)
    private readonly enderecosUsuariosRepository: Repository<EnderecoUsuario>,
  ) {}

  async createPublic(
    createUsuarioDto: CreateUsuarioDto,
  ): Promise<UsuarioSemSenha> {
    const nomeNormalizado = this.normalizeUpper(createUsuarioDto.nome);
    const emailNormalizado = this.normalizeUpper(createUsuarioDto.email);
    const enderecoNormalizado = this.normalizeEndereco(
      createUsuarioDto.endereco,
    );

    const usuarioComEmail = await this.usuariosRepository.findOne({
      where: { email: ILike(emailNormalizado) },
    });

    if (usuarioComEmail) {
      throw new ConflictException('Email ja cadastrado');
    }

    const senhaHash = await this.normalizeSenhaHash(
      createUsuarioDto.senha_hash,
    );

    const result = await this.usuariosRepository.manager.transaction(
      async (manager) => {
        const usuario = manager.create(Usuario, {
          nome: nomeNormalizado,
          email: emailNormalizado,
          senha_hash: senhaHash ?? null,
          tipo: 'CLIENTE',
          ativo: true,
        });
        const usuarioSalvo = await manager.save(Usuario, usuario);

        const endereco = manager.create(EnderecoUsuario, {
          usuario_id: usuarioSalvo.id,
          ...enderecoNormalizado,
        });
        const enderecoSalvo = await manager.save(EnderecoUsuario, endereco);

        return {
          usuario: usuarioSalvo,
          endereco: enderecoSalvo,
        };
      },
    );

    return this.sanitize(result.usuario, result.endereco);
  }

  async findAll(requesterUserId: string): Promise<UsuarioSemSenha[]> {
    const requester = await this.findActiveUserOrFail(requesterUserId);
    this.assertAdminUser(requester);

    const usuarios = await this.usuariosRepository.find({
      order: { id: 'ASC' },
    });
    const enderecosPorUsuario = await this.findEnderecosPorUsuarioIds(
      usuarios.map((usuario) => usuario.id),
    );

    return usuarios.map((usuario) =>
      this.sanitize(usuario, enderecosPorUsuario.get(usuario.id) ?? null),
    );
  }

  async findOne(id: string, requesterUserId: string): Promise<UsuarioSemSenha> {
    const requester = await this.findActiveUserOrFail(requesterUserId);
    const usuario = await this.findOneOrFail(id);
    this.assertCanAccessTargetUser(requester, usuario);

    const endereco = await this.enderecosUsuariosRepository.findOne({
      where: { usuario_id: usuario.id },
    });

    return this.sanitize(usuario, endereco);
  }

  async update(
    id: string,
    updateUsuarioDto: UpdateUsuarioDto,
    requesterUserId: string,
  ): Promise<UsuarioSemSenha> {
    const requester = await this.findActiveUserOrFail(requesterUserId);
    const usuario = await this.findOneOrFail(id);
    const isAdmin = this.isAdminUser(requester);
    const isSelf = requester.id === usuario.id;

    if (!isAdmin && !isSelf) {
      throw new ForbiddenException(
        'Voce nao tem permissao para alterar este usuario',
      );
    }

    if (!isAdmin) {
      if (updateUsuarioDto.tipo !== undefined) {
        throw new ForbiddenException(
          'Somente administradores podem alterar tipo de usuario',
        );
      }

      if (updateUsuarioDto.ativo !== undefined) {
        throw new ForbiddenException(
          'Somente administradores podem alterar status de ativacao',
        );
      }
    }

    if (updateUsuarioDto.email && updateUsuarioDto.email !== usuario.email) {
      const emailNormalizado = this.normalizeUpper(updateUsuarioDto.email);
      const usuarioComEmail = await this.usuariosRepository.findOne({
        where: { email: ILike(emailNormalizado) },
      });

      if (usuarioComEmail) {
        throw new ConflictException('Email ja cadastrado');
      }

      updateUsuarioDto.email = emailNormalizado;
    }

    if (updateUsuarioDto.nome !== undefined) {
      updateUsuarioDto.nome = this.normalizeUpper(updateUsuarioDto.nome);
    }

    const dadosAtualizacao: UpdateUsuarioDto = { ...updateUsuarioDto };
    const senhaHash = await this.normalizeSenhaHash(
      updateUsuarioDto.senha_hash,
    );

    if (senhaHash !== undefined) {
      dadosAtualizacao.senha_hash = senhaHash;
    }

    if (updateUsuarioDto.tipo !== undefined) {
      dadosAtualizacao.tipo = this.normalizeTipo(updateUsuarioDto.tipo);
    }

    this.usuariosRepository.merge(usuario, dadosAtualizacao);
    const usuarioAtualizado = await this.usuariosRepository.save(usuario);
    const endereco = await this.enderecosUsuariosRepository.findOne({
      where: { usuario_id: usuarioAtualizado.id },
    });

    return this.sanitize(usuarioAtualizado, endereco);
  }

  async remove(
    id: string,
    requesterUserId: string,
  ): Promise<{ message: string }> {
    const requester = await this.findActiveUserOrFail(requesterUserId);
    this.assertAdminUser(requester);

    const usuario = await this.findOneOrFail(id);
    await this.usuariosRepository.remove(usuario);

    return { message: 'Usuario removido com sucesso' };
  }

  async getMeuEndereco(
    userId: string,
  ): Promise<EnderecoUsuarioPublico | null> {
    await this.findActiveUserOrFail(userId);

    const endereco = await this.enderecosUsuariosRepository.findOne({
      where: { usuario_id: userId },
    });

    return this.sanitizeEndereco(endereco);
  }

  async atualizarMeuEndereco(
    userId: string,
    dto: CreateEnderecoUsuarioDto,
  ): Promise<EnderecoUsuarioPublico> {
    await this.findActiveUserOrFail(userId);

    const enderecoNormalizado = this.normalizeEndereco(dto);

    const enderecoExistente = await this.enderecosUsuariosRepository.findOne({
      where: { usuario_id: userId },
    });

    if (enderecoExistente) {
      this.enderecosUsuariosRepository.merge(
        enderecoExistente,
        enderecoNormalizado,
      );
      const atualizado =
        await this.enderecosUsuariosRepository.save(enderecoExistente);
      const sanitized = this.sanitizeEndereco(atualizado);

      if (!sanitized) {
        throw new BadRequestException(
          'Nao foi possivel persistir o endereco atualizado',
        );
      }

      return sanitized;
    }

    const novoEndereco = this.enderecosUsuariosRepository.create({
      usuario_id: userId,
      ...enderecoNormalizado,
    });
    const salvo = await this.enderecosUsuariosRepository.save(novoEndereco);
    const sanitized = this.sanitizeEndereco(salvo);

    if (!sanitized) {
      throw new BadRequestException('Nao foi possivel salvar o endereco');
    }

    return sanitized;
  }

  private async findOneOrFail(id: string): Promise<Usuario> {
    const usuario = await this.usuariosRepository.findOne({ where: { id } });

    if (!usuario) {
      throw new NotFoundException(`Usuario com id ${id} nao encontrado`);
    }

    return usuario;
  }

  private async findActiveUserOrFail(id: string): Promise<Usuario> {
    const usuario = await this.findOneOrFail(id);

    if (!usuario.ativo) {
      throw new ForbiddenException('Usuario inativo');
    }

    return usuario;
  }

  private assertCanAccessTargetUser(requester: Usuario, target: Usuario): void {
    if (requester.id === target.id) {
      return;
    }

    this.assertAdminUser(requester);
  }

  private assertAdminUser(usuario: Usuario): void {
    if (!this.isAdminUser(usuario)) {
      throw new ForbiddenException('Acesso permitido apenas para admin');
    }
  }

  private isAdminUser(usuario: Usuario): boolean {
    const tipoNormalizado =
      typeof usuario.tipo === 'string' ? usuario.tipo.trim().toUpperCase() : '';

    return usuario.ativo && tipoNormalizado === 'ADM';
  }

  private async findEnderecosPorUsuarioIds(
    usuarioIds: string[],
  ): Promise<Map<string, EnderecoUsuario>> {
    const ids = usuarioIds.map((id) => id.trim()).filter((id) => id.length > 0);

    if (ids.length === 0) {
      return new Map();
    }

    const enderecos = await this.enderecosUsuariosRepository.find({
      where: {
        usuario_id: In(ids),
      },
    });

    const map = new Map<string, EnderecoUsuario>();

    for (const endereco of enderecos) {
      map.set(endereco.usuario_id, endereco);
    }

    return map;
  }

  private sanitize(
    usuario: Usuario,
    endereco: EnderecoUsuario | null,
  ): UsuarioSemSenha {
    const usuarioSemSenha = {
      ...usuario,
    } as Omit<Usuario, 'senha_hash'> & {
      senha_hash?: string | null;
    };
    delete usuarioSemSenha.senha_hash;

    return {
      ...usuarioSemSenha,
      endereco: this.sanitizeEndereco(endereco),
    };
  }

  private sanitizeEndereco(
    endereco: EnderecoUsuario | null,
  ): EnderecoUsuarioPublico | null {
    if (!endereco) {
      return null;
    }

    return {
      id: endereco.id,
      usuario_id: endereco.usuario_id,
      logradouro: endereco.logradouro,
      numero: endereco.numero,
      complemento: endereco.complemento,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      estado: endereco.estado,
      cep: endereco.cep,
      created_at: endereco.created_at,
      updated_at: endereco.updated_at,
    };
  }

  private async normalizeSenhaHash(
    senhaHash?: string | null,
  ): Promise<string | null | undefined> {
    if (senhaHash === undefined) {
      return undefined;
    }

    if (senhaHash === null) {
      return null;
    }

    const senhaLimpa = senhaHash.trim();

    if (senhaLimpa.length === 0) {
      return null;
    }

    if (this.isBcryptHash(senhaLimpa)) {
      return senhaLimpa;
    }

    return hash(senhaLimpa, 10);
  }

  private isBcryptHash(senhaHash: string): boolean {
    return (
      senhaHash.startsWith('$2a$') ||
      senhaHash.startsWith('$2b$') ||
      senhaHash.startsWith('$2y$')
    );
  }

  private normalizeUpper(value: string): string {
    return value.trim().toUpperCase();
  }

  private normalizeTipo(tipo?: string | null): string {
    if (!tipo) {
      return 'CLIENTE';
    }

    const tipoNormalizado = tipo.trim().toUpperCase();

    if (tipoNormalizado !== 'ADM' && tipoNormalizado !== 'CLIENTE') {
      throw new BadRequestException('Tipo de usuario invalido');
    }

    return tipoNormalizado;
  }

  private normalizeEndereco(
    endereco: CreateEnderecoUsuarioDto,
  ): EnderecoNormalizado {
    if (!endereco || typeof endereco !== 'object') {
      throw new BadRequestException('Endereco obrigatorio para cadastro');
    }

    const logradouro = this.requireUpperText(
      endereco.logradouro,
      'Logradouro obrigatorio',
    );
    const numero = this.requireUpperText(endereco.numero, 'Numero obrigatorio');
    const complemento = this.optionalUpperText(endereco.complemento);
    const bairro = this.requireUpperText(endereco.bairro, 'Bairro obrigatorio');
    const cidade = this.requireUpperText(endereco.cidade, 'Cidade obrigatoria');
    const estado = this.normalizeEstado(endereco.estado);
    const cep = this.normalizeCep(endereco.cep);

    return {
      logradouro,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      cep,
    };
  }

  private requireUpperText(value: string, message: string): string {
    const normalized = this.optionalUpperText(value);

    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private optionalUpperText(value?: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    return normalized.toUpperCase();
  }

  private normalizeEstado(value: string): string {
    const estado = this.requireUpperText(value, 'Estado obrigatorio');

    if (!/^[A-Z]{2}$/.test(estado)) {
      throw new BadRequestException('Estado deve ter 2 letras (UF)');
    }

    return estado;
  }

  private normalizeCep(value: string): string {
    if (!value || !value.trim()) {
      throw new BadRequestException('CEP obrigatorio');
    }

    const digits = value.replace(/\D/g, '');

    if (digits.length !== 8) {
      throw new BadRequestException('CEP invalido');
    }

    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
}
